/**
 * Feishu Utils Module
 *
 * 飞书工具函数模块
 */

export {
	extractPermissionError,
	shouldNotifyPermissionError,
	PERMISSION_ERROR_COOLDOWN_MS,
	permissionErrorNotifiedAt,
	type PermissionError,
} from "./permission-error.js";
