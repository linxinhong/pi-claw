/**
 * Auth Card Builders
 *
 * 构建飞书 OAuth 授权卡片的工具函数
 */

// ============================================================================
// OAuth Authorization Card
// ============================================================================

/**
 * 将 URL 转换为飞书应用内网页 URL
 */
function toInAppWebUrl(targetUrl: string): string {
	const encoded = encodeURIComponent(targetUrl);
	const lkMeta = encodeURIComponent(
		JSON.stringify({
			"page-meta": {
				showNavBar: "false",
				showBottomNavBar: "false",
			},
		})
	);
	return (
		"https://applink.feishu.cn/client/web_url/open" +
		`?mode=sidebar-semi&max_width=800&reload=false&url=${encoded}&lk_meta=${lkMeta}`
	);
}

/**
 * 格式化 scope 描述
 */
function formatScopeDescription(scope: string): string {
	const scopes = scope?.split(/\s+/).filter(Boolean);
	const desc = "授权后，应用将能够以您的身份执行相关操作。";
	if (!scopes?.length) return desc;
	return desc + "\n\n所需权限：\n" + scopes.map((s) => `- ${s}`).join("\n");
}

/**
 * 构建 OAuth 授权卡片（用户点击链接授权）
 */
export function buildOAuthCard(params: {
	verificationUriComplete: string;
	expiresMin: number;
	scope: string;
}): any {
	const { verificationUriComplete, expiresMin, scope } = params;
	const inAppUrl = toInAppWebUrl(verificationUriComplete);
	const multiUrl = {
		url: inAppUrl,
		pc_url: inAppUrl,
		android_url: inAppUrl,
		ios_url: inAppUrl,
	};
	const scopeDesc = formatScopeDescription(scope);

	return {
		schema: "2.0",
		config: {
			wide_screen_mode: false,
			style: {
				color: {
					"light-yellow-bg": {
						light_mode: "rgba(255, 214, 102, 0.12)",
						dark_mode: "rgba(255, 214, 102, 0.08)",
					},
				},
			},
		},
		header: {
			title: {
				tag: "plain_text",
				content: "需要您的授权才能继续",
			},
			subtitle: {
				tag: "plain_text",
				content: "",
			},
			template: "blue",
			padding: "12px 12px 12px 12px",
			icon: {
				tag: "standard_icon",
				token: "lock-chat_filled",
			},
		},
		body: {
			elements: [
				// 授权说明
				{
					tag: "markdown",
					content: scopeDesc,
					text_size: "normal",
				},
				// 授权按钮
				{
					tag: "column_set",
					flex_mode: "none",
					horizontal_align: "right",
					columns: [
						{
							tag: "column",
							width: "auto",
							elements: [
								{
									tag: "button",
									text: { tag: "plain_text", content: "前往授权" },
									type: "primary",
									size: "medium",
									multi_url: multiUrl,
								},
							],
						},
					],
				},
				// 失效时间提醒
				{
					tag: "markdown",
					content: `<font color='grey'>授权链接将在 ${expiresMin} 分钟后失效，届时需重新发起</font>`,
					text_size: "notation",
				},
			],
		},
	};
}

// ============================================================================
// App Scope Card (Admin Permission Guide)
// ============================================================================

/**
 * 构建应用权限引导卡片（管理员申请权限）
 */
export function buildAppScopeCard(params: {
	missingScopes: string[];
	appId: string;
	grantUrl: string;
	operationId?: string;
}): any {
	const { missingScopes, appId, grantUrl, operationId } = params;
	const multiUrl = { url: grantUrl, pc_url: grantUrl, android_url: grantUrl, ios_url: grantUrl };
	const scopeList = missingScopes.map((s) => `• ${s}`).join("\n");

	return {
		schema: "2.0",
		config: { wide_screen_mode: true },
		header: {
			title: { tag: "plain_text", content: "🔐 需要申请权限才能继续" },
			template: "orange",
		},
		body: {
			elements: [
				{
					tag: "markdown",
					content: "调用前，请你先申请以下**所有**权限：",
					text_size: "normal",
				},
				{
					tag: "column_set",
					flex_mode: "none",
					background_style: "grey",
					horizontal_spacing: "default",
					columns: [
						{
							tag: "column",
							width: "weighted",
							weight: 1,
							vertical_align: "center",
							elements: [{ tag: "markdown", content: scopeList }],
						},
					],
				},
				{ tag: "hr" },
				{
					tag: "column_set",
					flex_mode: "none",
					horizontal_spacing: "default",
					columns: [
						{
							tag: "column",
							width: "weighted",
							weight: 3,
							vertical_align: "center",
							elements: [{ tag: "markdown", content: "**第一步：申请所有权限**" }],
						},
						{
							tag: "column",
							width: "weighted",
							weight: 1,
							vertical_align: "center",
							elements: [
								{
									tag: "button",
									text: { tag: "plain_text", content: "去申请" },
									type: "primary",
									multi_url: multiUrl,
								},
							],
						},
					],
				},
				{
					tag: "column_set",
					flex_mode: "none",
					horizontal_spacing: "default",
					columns: [
						{
							tag: "column",
							width: "weighted",
							weight: 3,
							vertical_align: "center",
							elements: [{ tag: "markdown", content: "**第二步：创建版本并审核通过**" }],
						},
						{
							tag: "column",
							width: "weighted",
							weight: 1,
							vertical_align: "center",
							elements: [
								{
									tag: "button",
									text: { tag: "plain_text", content: "已完成" },
									type: "default",
									value: { action: "app_auth_done", operation_id: operationId ?? "" },
								},
							],
						},
					],
				},
			],
		},
	};
}

// ============================================================================
// Auth Result Cards
// ============================================================================

/**
 * 构建授权成功卡片
 */
export function buildAuthSuccessCard(): any {
	return {
		schema: "2.0",
		config: {
			wide_screen_mode: false,
			style: {
				color: {
					"light-green-bg": {
						light_mode: "rgba(52, 199, 89, 0.12)",
						dark_mode: "rgba(52, 199, 89, 0.08)",
					},
				},
			},
		},
		header: {
			title: {
				tag: "plain_text",
				content: "授权成功",
			},
			subtitle: {
				tag: "plain_text",
				content: "",
			},
			template: "green",
			padding: "12px 12px 12px 12px",
			icon: {
				tag: "standard_icon",
				token: "yes_filled",
			},
		},
		body: {
			elements: [
				{
					tag: "markdown",
					content:
						"您的飞书账号已成功授权，正在为您继续执行操作。\n\n" +
						"<font color='grey'>如需撤销授权，可随时告诉我。</font>",
				},
			],
		},
	};
}

/**
 * 构建授权失败卡片
 */
export function buildAuthFailedCard(reason: string): any {
	return {
		schema: "2.0",
		config: {
			wide_screen_mode: false,
			style: {
				color: {
					"light-grey-bg": {
						light_mode: "rgba(142, 142, 147, 0.12)",
						dark_mode: "rgba(142, 142, 147, 0.08)",
					},
				},
			},
		},
		header: {
			title: {
				tag: "plain_text",
				content: "授权未完成",
			},
			subtitle: {
				tag: "plain_text",
				content: "",
			},
			template: "yellow",
			padding: "12px 12px 12px 12px",
			icon: {
				tag: "standard_icon",
				token: "warning_filled",
			},
		},
		body: {
			elements: [
				{
					tag: "markdown",
					content: `授权失败：${reason}\n\n请重新发起授权。`,
				},
			],
		},
	};
}

/**
 * 构建应用权限处理中卡片
 */
export function buildAppAuthProgressCard(): any {
	return {
		schema: "2.0",
		config: { wide_screen_mode: false },
		header: {
			title: { tag: "plain_text", content: "授权成功" },
			subtitle: { tag: "plain_text", content: "" },
			template: "green",
			padding: "12px 12px 12px 12px",
			icon: { tag: "standard_icon", token: "yes_filled" },
		},
		body: {
			elements: [
				{
					tag: "markdown",
					content: "您的应用权限已开通，正在为您发起用户授权",
					text_size: "normal",
				},
			],
		},
	};
}
