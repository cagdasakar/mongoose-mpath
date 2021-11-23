const {Schema} = require("mongoose");
const _orderBy = require("lodash/orderBy");

const mpathUtil = {};

mpathUtil.getLevelByPathAndSeparator = (path, separator) => (path ? path.split(separator).length : 1);

mpathUtil.mongoSortToLodashSort = (mongoSortObj) => {
    const lodashSortObj = {
        keys: [],
        orders: [],
    };

    for (let key in mongoSortObj) {
        if (mongoSortObj.hasOwnProperty(key)) {
            let sortOrder = mongoSortObj[key] === -1 ? "desc" : "asc";
            lodashSortObj.keys.push(key);
            lodashSortObj.orders.push(sortOrder);
        }
    }

    return lodashSortObj;
};

mpathUtil.listToTree = (list, sort) => {
    let nodeMap = {};
    let currentNode;
    let rootNodes = [];
    let index;
    let lodashSort = mpathUtil.mongoSortToLodashSort(sort);
    const shouldSort = lodashSort.keys.length > 0;

    for (index = 0; index < list.length; index += 1) {
        currentNode = list[index];
        currentNode.children = [];
        nodeMap[currentNode._id] = index;

        const hasParentInMap = nodeMap.hasOwnProperty(currentNode.parent);

        if (hasParentInMap) {
            list[nodeMap[currentNode.parent]].children.push(currentNode);

            if (shouldSort) {
                list[nodeMap[currentNode.parent]].children = _orderBy(
                    list[nodeMap[currentNode.parent]].children,
                    lodashSort.keys,
                    lodashSort.orders,
                );
            }
        } else {
            rootNodes.push(currentNode);
        }
    }

    if (shouldSort) {
        rootNodes = _orderBy(rootNodes, lodashSort.keys, lodashSort.orders);
    }

    return rootNodes;
};

/**
 * Main plugin method
 * @param  {Schema} schema  Mongoose Schema
 * @param  {Object} options [description]
 */
function mpathPlugin(schema, options) {
    const onDelete = (options && options.onDelete) || "REPARENT"; // or 'DELETE'
    // const idType = (options && options.idType) || Schema.ObjectId;
    const pathSeparator = (options && options.pathSeparator) || "#";
    const pathSeparatorRegex = "[" + pathSeparator + "]";

    schema.add({
        parent: {
            index: true,
            // set: (value) => (value instanceof Object && value._id ? value._id : value),
            type: Schema.ObjectId,
        },
        path: {
            index: true,
            type: String,
        },
        children: [],
    });

    /**
     * Mongoose schema pre save hook
     */
    schema.pre("save", async function preSave() {
        const hasModifiedParent = this.isModified("parent");
        const pathUpdateIsRequired = this.isNew || hasModifiedParent;

        if (!pathUpdateIsRequired) {
            return;
        }

        console.log("ON PRE SAVE, this", this);
        console.log("HasModifiedParent:", hasModifiedParent);

        const self = this;
        const Model = self.model(self.constructor.modelName);

        const updateChildPaths = async (pathToReplace, replacementPath) => {
            console.log("======================");
            console.log("Updating child paths...");
            console.log("OLD PATH:", pathToReplace);
            console.log("NEW PATH:", replacementPath);

            if (!pathToReplace) {
                console.log("Skipping..");
                return;
            }

            const childConditions = {
                path: {$regex: "^" + pathToReplace + pathSeparatorRegex},
            };

            // const childStream = self.collection.find(childConditions).stream();
            const childCursor = await Model.find(childConditions).cursor();

            return childCursor.eachAsync((childDoc) => {
                console.log("Old Child.path", childDoc.path);

                const newChildPath = replacementPath + childDoc.path.substr(pathToReplace.length);
                console.log("New Child.path:", newChildPath);

                return Model.updateOne({_id: childDoc._id}, {$set: {path: newChildPath}});
            });
        };

        const oldPath = self.path;

        if (this.parent) {
            console.log("This.parent:", this.parent);

            const parentDoc = await Model.findOne({_id: this.parent});
            console.log("Found parentDoc:", parentDoc);

            const newPath = parentDoc.path + pathSeparator + self._id.toString();
            self.path = newPath;
            console.log("Old Path:", oldPath);
            console.log("New Path:", newPath);

            if (!hasModifiedParent) {
                return;
            }

            // Rewrite child paths when parent is changed
            return updateChildPaths(oldPath, newPath);
        } else {
            console.log("NO Parent:", this.parent);

            const newPath = self._id.toString();
            self.path = newPath;

            if (hasModifiedParent) {
                return updateChildPaths(oldPath, newPath);
            }
        }
    });

    /**
     * Mongoose schema pre remove hook
     */
    schema.pre("remove", async function preRemove() {
        if (!this.path) {
            return;
        }

        console.log("ON PRE REMOVE, this", this);

        const Model = this.model(this.constructor.modelName);

        if ("DELETE" === onDelete) {
            const deleteConditions = {
                path: {$regex: "^" + this.path + pathSeparatorRegex},
            };
            return Model.deleteMany(deleteConditions);
        } else {
            // 'REPARENT'
            const parentOfDeletedDoc = this.parent;
            console.log("Parent of DeletedDoc:", parentOfDeletedDoc);

            const childConditions = {parent: this._id};
            const childCursor = Model.find(childConditions).cursor();

            return childCursor.eachAsync((childDoc) => {
                childDoc.parent = parentOfDeletedDoc;
                return childDoc.save();
            });
        }
    });

    schema.virtual("level").get(function virtualPropLevel() {
        return mpathUtil.getLevelByPathAndSeparator(this.path, pathSeparator);
    });

    schema.methods.getImmediateChildren = function getImmediateChildren(conditions = {}, fields = null, options = {}) {

        if (conditions["$query"]) {
            conditions["$query"]["parent"] = this._id;
        } else {
            conditions["parent"] = this._id;
        }

        return this.model(this.constructor.modelName).find(conditions, fields, options);
    };

    schema.methods.getAllChildren = function getAllChildren(conditions = {}, fields = null, options = {}) {

        const pathConditions = {$regex: "^" + this.path + pathSeparatorRegex};

        if (conditions["$query"]) {
            conditions["$query"]["path"] = pathConditions;
        } else {
            conditions["path"] = pathConditions;
        }

        return this.model(this.constructor.modelName).find(conditions, fields, options);
    };

    /**
     * Get parent document
     * @param  {String} fields  [description]
     * @param  {Object} options [description]
     * @return {Promise.<Mongoose.document>}         [description]
     */
    schema.methods.getParent = function getParent(fields = null, options = {}) {
        const conditions = {_id: this.parent};

        return this.model(this.constructor.modelName).findOne(conditions, fields, options);
    };

    schema.methods.getAncestors = function getAncestors(conditions = {}, fields = null, options = {}) {

        let ancestorIds = [];

        if (this.path) {
            ancestorIds = this.path.split(pathSeparator);
            ancestorIds.pop();
        }

        if (conditions["$query"]) {
            conditions["$query"]["_id"] = {$in: ancestorIds};
        } else {
            conditions["_id"] = {$in: ancestorIds};
        }

        return this.model(this.constructor.modelName).find(conditions, fields, options);
    };

    /**
     * Returns tree of child documents
     * @param  {Object} args [description]
     * @return {Promise.<Object>}      [description]
     */
    schema.statics.getChildrenTree = async function getChildrenTree(args = {}) {
        const rootDoc = args.rootDoc ? args.rootDoc : null;
        let fields = args.fields ? args.fields : null;
        let filters = args.filters ? args.filters : {};
        let minLevel = args.minLevel ? args.minLevel : 1;
        let maxLevel = args.maxLevel ? args.maxLevel : 9999;
        let options = args.options ? args.options : {};
        let populateStr = args.populate ? args.populate : "";

        // filters
        if (rootDoc) {
            filters.path = {$regex: "^" + rootDoc.path + pathSeparator};
        }

        // fields
        // include 'path' and 'parent' if not already included
        if (fields) {
            if (fields instanceof Object) {
                if (!fields.hasOwnProperty("path")) {
                    fields["path"] = 1;
                }
                if (!fields.hasOwnProperty("parent")) {
                    fields["parent"] = 1;
                }
            } else {
                if (!fields.match(/path/)) {
                    fields += " path";
                }
                if (!fields.match(/parent/)) {
                    fields += " parent";
                }
            }
        }

        // options:sort
        // passed options.sort is applied after entries are fetched from database
        let postSortObj = {};

        if (options.sort) {
            postSortObj = options.sort;
        }

        options.sort = {path: 1};

        try {
            const result = await this.find(filters, fields, options).populate(populateStr);

            const filteredResult = result.filter((node) => {
                const level = mpathUtil.getLevelByPathAndSeparator(node.path, pathSeparator);
                return level >= minLevel && level <= maxLevel;
            });

            return mpathUtil.listToTree(filteredResult, postSortObj);
        } catch (err) {
            console.error(err);
            throw err;
        }
    };

    /**
     * Static method of getChildrenTree schema
     * @param  {Object} args [description]
     * @return {Promise.<Mongoose.document>}      [description]
     */
    schema.methods.getChildrenTree = function (args = {}) {
        args.rootDoc = this;

        return this.constructor.getChildrenTree(args);
    };
}

module.exports = exports = mpathPlugin;
module.exports.util = mpathUtil;
