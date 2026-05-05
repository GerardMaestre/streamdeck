export type PluginHookContext = {
  plugin: {
    id: string;
    version: string;
    capabilities: string[];
  };
};

export type PluginModule = {
  onLoad?: (ctx: PluginHookContext) => void | Promise<void>;
  onUnload?: (ctx: PluginHookContext) => void | Promise<void>;
};

export declare function definePlugin<T extends PluginModule>(plugin: T): T;
export declare function defineManifest<T extends { id: string; entry: string; apiVersion: number }>(manifest: T): T;
