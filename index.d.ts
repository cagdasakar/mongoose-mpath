import {RefType, Schema, Document} from "mongoose";

interface MPathPluginOptions {
    onDelete?: "REPARENT" | "DELETE";
    // idType?: string | Types.ObjectId | Types.ObjectIdConstructor;
    pathSeparator?: string;
}

export type WithMaterializedPath = {
    path?: string;
    parent?: unknown;
    children?: Array<unknown>;
};

declare function materializedPathPlugin(schema: Schema, options: MPathPluginOptions): void;

export default materializedPathPlugin;
