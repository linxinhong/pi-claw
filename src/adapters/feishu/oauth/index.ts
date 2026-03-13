/**
 * Feishu OAuth Module
 *
 * 飞书 OAuth 授权模块 - 提供自动授权功能
 */

// Device Flow
export {
	requestDeviceAuthorization,
	pollDeviceToken,
	resolveOAuthEndpoints,
	type DeviceAuthResponse,
	type DeviceFlowTokenData,
	type DeviceFlowResult,
	type DeviceFlowError,
	type LarkBrand,
} from "./device-flow.js";

// Token Store
export {
	getStoredToken,
	setStoredToken,
	removeStoredToken,
	tokenStatus,
	maskToken,
	type StoredToken,
} from "./token-store.js";

// Auth Cards
export {
	buildOAuthCard,
	buildAppScopeCard,
	buildAuthSuccessCard,
	buildAuthFailedCard,
	buildAppAuthProgressCard,
} from "./auth-cards.js";

// Auto Auth
export {
	handlePermissionErrorWithAutoAuth,
	isUserAuthorized,
	getUserAccessToken,
	revokeUserAuth,
	type AuthContext,
	type AuthResult,
	type SendCardFunction,
	type UpdateCardFunction,
	type SendSyntheticMessageFunction,
} from "./auto-auth.js";
