import {Model, ObjectId, QueryWithHelpers, Schema, Types} from "mongoose";

interface MPathPluginOptions {
    onDelete?: "REPARENT" | "DELETE";
    // idType?: string | Types.ObjectId | Types.ObjectIdConstructor;
    pathSeparator?: string;
}

type TWithMaterializedPath = {
    parent: ObjectId;
    path: string;
    children: Array<unknown>;
};

declare function materializedPathPlugin(schema: Schema, options: MPathPluginOptions): void;

export default materializedPathPlugin;
