/**
 * Plugin Loader - Plugin 自动发现和加载
 *
 * 自动发现 plugins 目录下的所有 plugin 模块并加载
 * 根据配置决定哪些插件启用
 */

import { readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { Plugin, PluginsConfig } from "./types.js";
import type { PluginManager } from "./manager.js";
import type { PluginHookContext } from "../hook/types.js";
import { HOOK_NAMES } from "../hook/index.js";
import { getHookManager } from "../hook/index.js";

import { HOOK_NAMES as HOOK_NAMES_CONST } from "../hook/types.js";
