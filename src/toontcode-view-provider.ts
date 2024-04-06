import * as vscode from 'vscode';
import CodeGenByTemplateUtil from './utils/codeGenByTemplateUtil';
import chatApi from './toone-code/chat-api';
import inlineCompletionProvider from "./provider/inlineCompletionProvider";
import inlineCompletionProviderWithCommand from "./provider/inlineCompletionProviderWithCommand";

export default class ToontCodeViewProvider implements vscode.WebviewViewProvider {
	private webView?: vscode.WebviewView;
	private leftOverMessage?: any;
	private inProgress: boolean = false;
	private questionCounter: number = 0;
	private response: string = "";
	private abortController?: AbortController;
	private currentMessageId: string = "";
	public autoScroll: boolean;
	public useAutoLogin?: boolean = true;

	private conversationId?: string;
	private messageId?: string;
	private chatCodeApi?: chatApi;

	/**
	 * 构造方法
	 * @param context vscode上下文
	 */
	constructor(private context: vscode.ExtensionContext) {
		this.autoScroll = !!vscode.workspace.getConfiguration("toonecode").get("response.autoScroll");
		this.setMethod();
		this.login();
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this.webView = webviewView;
		webviewView.webview.options = {
			// Allow scripts in the webview
			enableScripts: true,
			localResourceRoots: [
				this.context.extensionUri
			]
		};

		webviewView.webview.html = this.getWebviewHtml(webviewView.webview);
		webviewView.webview.onDidReceiveMessage(async data => {
			switch (data.type) {
				//插入代码

				case 'editCode':
					const escapedString = (data.value as string).replace(/\$/g, '\\$');;
					vscode.window.activeTextEditor?.insertSnippet(new vscode.SnippetString(escapedString));
					this.logEvent("code-inserted");
					break;
				//自由问答
				case 'addFreeTextQuestion':
					this.sendApiRequest(data.value, { command: "freeText", messageId: data.messageId });
					break;
				case 'openNew':
					const document = await vscode.workspace.openTextDocument({
						content: data.value,
						language: data.language?.toLowerCase()
					});
					vscode.window.showTextDocument(document);

					this.logEvent(data.language === "markdown" ? "code-exported" : "code-opened");
					break;
				//停止生成
				case "stopGenerating":
					this.stopGenerating();
					break;
				case 'clearConversation':
					this.messageId = undefined;
					this.conversationId = undefined;
					this.logEvent("conversation-cleared");
					break;
				case 'login':
					this.login();
					break;
			}
		});
	}

	//获取页面
	private getWebviewHtml(webview: vscode.Webview) {
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.js'));
		const stylesMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.css'));

		const vendorHighlightCss = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vendor', 'highlight.min.css'));
		const vendorHighlightJs = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vendor', 'highlight.min.js'));
		const vendorMarkedJs = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vendor', 'marked.min.js'));
		const vendorTailwindJs = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vendor', 'tailwindcss.3.2.4.min.js'));
		const vendorTurndownJs = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vendor', 'turndown.js'));

		const nonce = this.getRandomId();
		const indexCss = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'index.css'));
		const indexJs = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'index.js'));

		return `<!DOCTYPE html>
		<html lang="en">
		  <head>
			<meta charset="UTF-8">
			<link rel="icon" href="./favicon.ico">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>TooneCode</title>
		
			<script type="module" crossorigin src="${indexJs}"></script>
			<link rel="stylesheet" crossorigin href="${indexCss}">
		  </head>
		  <body class="overflow-hidden">
			<div id="app"></div>
		  </body>
		</html>`;

		return `<!DOCTYPE html>
			<html lang="zh-hans">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0" data-license="isc-gnc">

				<link href="${stylesMainUri}" rel="stylesheet">
				<link href="${vendorHighlightCss}" rel="stylesheet">
				<script src="${vendorHighlightJs}"></script>
				<script src="${vendorMarkedJs}"></script>
				<script src="${vendorTailwindJs}"></script>
				<script src="${vendorTurndownJs}"></script>
			</head>
			<body class="overflow-hidden">
				<div class="flex flex-col h-screen">
					<div id="introduction" class="flex flex-col justify-between h-full justify-center px-6 w-full relative login-screen overflow-auto">
						<div data-license="isc-gnc-hi-there" class="flex items-start text-center features-block my-5">
							<div class="flex flex-col gap-3.5 flex-1">
								<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true" class="w-6 h-6 m-auto">
									<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"></path>
								</svg>
								<h2>特性</h2>
								<ul class="flex flex-col gap-3.5 text-xs">
									<li class="features-li w-full border border-zinc-700 p-3 rounded-md">改进你的代码，添加测试并发现bug</li>
									<li class="features-li w-full border border-zinc-700 p-3 rounded-md">自动复制或创建新文件</li>
									<li class="features-li w-full border border-zinc-700 p-3 rounded-md">语法高亮与自动语言检测</li>
								</ul>
							</div>
						</div>
						<div class="flex flex-col gap-4 h-full items-center justify-end text-center">
							<button id="login-button" class="mb-4 btn btn-primary flex gap-2 justify-center p-3 rounded-md" style="visibility:hidden;">登录</button>
							<button id="list-conversations-link" class="hidden mb-4 btn btn-primary flex gap-2 justify-center p-3 rounded-md" title="You can access this feature via the kebab menu below. NOTE: Only available with Browser Auto-login method">
								<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" /></svg>&nbsp;Show conversations
							</button>
							<p class="max-w-sm text-center text-xs text-slate-500" style="visibility:hidden;">
								<a title="" id="settings-button" href="#">Update settings</a>&nbsp; | &nbsp;<a title="" id="settings-prompt-button" href="#">Update prompts</a>
							</p>
						</div>
					</div>

					<div class="flex-1 overflow-y-auto" id="qa-list" data-license="isc-gnc"></div>

					<div class="flex-1 overflow-y-auto hidden" id="conversation-list" data-license="isc-gnc"></div>

					<div id="in-progress" class="pl-4 pt-2 flex items-center hidden" data-license="isc-gnc">
						<div class="typing">正在思考</div>
						<div class="spinner">
							<div class="bounce1"></div>
							<div class="bounce2"></div>
							<div class="bounce3"></div>
						</div>

						<button id="stop-button" class="btn btn-primary flex items-end p-1 pr-2 rounded-md ml-5">
							<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 mr-2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>停止</button>
					</div>

					<div class="p-4 flex items-center pt-2" data-license="isc-gnc">
						<div class="flex-1 textarea-wrapper">
							<textarea
								type="text"
								rows="1" data-license="isc-gnc"
								id="question-input"
								placeholder="输入一个问题..."
								onInput="this.parentNode.dataset.replicatedValue = this.value"></textarea>
						</div>
						<div id="chat-button-wrapper" class="absolute bottom-14 items-center more-menu right-8 border border-gray-200 shadow-xl hidden text-xs" data-license="isc-gnc">
							<button class="flex gap-2 items-center justify-start p-2 w-full" id="clear-button"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>&nbsp;新的聊天</button>	
							<button class="flex gap-2 items-center justify-start p-2 w-full" id="settings-button"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>&nbsp;更新设置</button>
							<button class="flex gap-2 items-center justify-start p-2 w-full" id="export-button"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>&nbsp;导出markdown</button>
						</div>
						<div id="question-input-buttons" class="right-6 absolute p-0.5 ml-5 flex items-center gap-2">
							<button id="more-button" title="More actions" class="rounded-lg p-0.5" data-license="isc-gnc">
								<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z" /></svg>
							</button>

							<button id="ask-button" title="提交提示" class="ask-button rounded-lg p-0.5">
								<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>
							</button>
						</div>
					</div>
				</div>

				<script nonce="${nonce}" src="${scriptUri}"></script>
			</body>
			</html>`;
	}

	private login() {
		this.prepareConversation().then(success => {
			if (success) {
				this.sendMessage({ type: 'loginSuccessful', showConversations: this.useAutoLogin }, true);
				this.logEvent("logged-in");
			}
		});
	}

	public async sendApiRequest(prompt: string, options: { command: string, code?: string, previousAnswer?: string, language?: string, chatType?: string, messageId?: string }) {
		if (this.inProgress) {
			// The AI is still thinking... Do not accept more questions.
			return;
		}
		let { chatType } = options;
		this.questionCounter++;
		const responseInMarkdown = true;

		this.response = '';
		let question = this.processQuestion(prompt, options.code, options.language);

		// If the ChatGPT view is not in focus/visible; focus on it to render Q&A
		if (!this.webView) {
			vscode.commands.executeCommand('vscode-toonecode.view.focus');
			await new Promise((resole, reject) => setTimeout(() => {
				resole(true);
			}, 800));
		} else {
			this.webView?.show?.(true);
		}

		this.inProgress = true;
		this.abortController = new AbortController();
		//在视图显示进度
		this.sendMessage({ type: 'showInProgress', inProgress: this.inProgress, showStopButton: true });
		this.currentMessageId = this.getRandomId();
		//在视图添加一个问题框
		this.sendMessage({ type: 'addQuestion', value: prompt, code: options.code, autoScroll: this.autoScroll, messageId: this.currentMessageId });

		if (this.chatCodeApi) {
			try {
				const chatResponse = await this.chatCodeApi.sendMessage(question, {
					systemMessage: this.systemContext,
					messageId: this.conversationId,
					parentMessageId: this.messageId,
					abortSignal: this.abortController.signal,
					stream: true,
					chatType: chatType,
					onProgress: (message) => {
						this.response = message.text;
						this.sendMessage({
							type: 'addResponse', value: this.response, id: this.conversationId,
							autoScroll: this.autoScroll, responseInMarkdown, messageId: this.currentMessageId
						});
					},
					onDone: (message) => {
						this.sendMessage({
							type: 'addResponse', value: this.response, done: true, id: this.conversationId,
							autoScroll: this.autoScroll, responseInMarkdown, messageId: this.currentMessageId
						});
						this.inProgress = false;
						this.sendShowInProgress();
					}
				});
				({ text: this.response, id: this.conversationId, parentMessageId: this.messageId } = chatResponse);

				return;
			} catch (error) {
				//出错了干点什么
				return;
			}
		}

		//没有接口，这里也可以发送一下消息过去
		// ****
		this.inProgress = false;
		this.sendShowInProgress();

	}
	private sendShowInProgress() {
		this.sendMessage({ type: 'showInProgress', inProgress: this.inProgress });
	}
	/**
		 * Message sender, stores if a message cannot be delivered
		 * @param message Message to be sent to WebView
		 * @param ignoreMessageIfNullWebView We will ignore the command if webView is null/not-focused
		 */
	public sendMessage(message: any, ignoreMessageIfNullWebView?: boolean) {
		if (this.webView) {
			this.webView.webview?.postMessage(message);
		} else if (!ignoreMessageIfNullWebView) {
			this.leftOverMessage = message;
		}
	}

	public stopGenerating(): void {
		this.abortController?.abort?.();
		this.inProgress = false;
		this.sendMessage({ type: 'showInProgress', inProgress: this.inProgress });
		const responseInMarkdown = true;//!this.isCodexModel;
		this.sendMessage({ type: 'addResponse', value: this.response, done: true, id: this.conversationId, autoScroll: this.autoScroll, responseInMarkdown });
		this.logEvent("stopped-generating");
	}

	public clearSession(): void {
		this.stopGenerating();
		if (this.chatCodeApi) {
			this.chatCodeApi.clearCacheMessage();
		}
		this.chatCodeApi = undefined;
		this.messageId = undefined;
		this.conversationId = undefined;
		this.logEvent("cleared-session");
	}

	public processQuestion(question: string, code?: string, language?: string) {
		if (code) {
			// Add prompt prefix to the code if there was a code block selected
			// question = `${question}${language ? ` (The following code is in ${language} programming language)` : ''}: ${code}`;
			question = `${question}${language ? ` (当前编程语言是${language})` : ''}: ${code}`;
		}
		return question + "\r\n";
	}

	public async prepareConversation(modelChanged = false): Promise<boolean> {
		if (modelChanged && this.useAutoLogin) {
			return false;
		}
		const configuration = vscode.workspace.getConfiguration("toonecode");
		const apiBaseUrl = configuration.get("apiBaseUrl") as string;

		this.chatCodeApi = new chatApi({
			apiBaseUrl: apiBaseUrl?.trim() || undefined,
			//organization,
			//fetch: fetch,
			// completionParams: {
			// 	temperature: temperature,
			// 	top_p: top_p,
			// 	top_k: top_k,
			// 	seed: 8888,
			// 	max_length: max_tokens,
			// }
		});

		//this.sendMessage({ type: 'loginSuccessful', showConversations: this.useAutoLogin }, true);

		return true;
	}

	public addCommnentGen(editor: vscode.TextEditor, myStatusBarItem: vscode.StatusBarItem) {
		if (!this.chatCodeApi) {
			vscode.window.showWarningMessage("无法连接到远程服务器");
			return false;
		}

		return CodeGenByTemplateUtil(editor, myStatusBarItem, true, this.chatCodeApi, this);
	}

	public inlineCompletionProviderWithCommand(
		g_isLoading: boolean,
		myStatusBarItem: vscode.StatusBarItem,
		reGetCompletions: boolean,
		originalColor: string | vscode.ThemeColor | undefined,
		extensionContext: vscode.ExtensionContext): vscode.InlineCompletionItemProvider {
		return inlineCompletionProviderWithCommand(g_isLoading, myStatusBarItem, reGetCompletions, originalColor, extensionContext, this.chatCodeApi, this);
	}

	public inlineCompletionProvider(
		g_isLoading: boolean,
		myStatusBarItem: vscode.StatusBarItem,
		reGetCompletions: boolean,
		originalColor: string | vscode.ThemeColor | undefined,
		extensionContext: vscode.ExtensionContext): vscode.InlineCompletionItemProvider {
		return inlineCompletionProvider(g_isLoading, myStatusBarItem, reGetCompletions, originalColor, extensionContext, this.chatCodeApi, this);
	}

	public setMethod(): void {
		// this.loginMethod = vscode.workspace.getConfiguration("chatgpt").get("method") as LoginMethod;
		// this.useGpt3 = true;
		this.useAutoLogin = false;
		this.clearSession();
	}

	public setAuthType(): void {
		//this.authType = vscode.workspace.getConfiguration("chatgpt").get("authenticationType");
		this.clearSession();
	}

	private logEvent(eventName: string, properties?: {}): void {
		// You can initialize your telemetry reporter and consume it here - *replaced with console.debug to prevent unwanted telemetry logs
		// this.reporter?.sendTelemetryEvent(eventName, { "chatgpt.loginMethod": this.loginMethod!, "chatgpt.authType": this.authType!, "chatgpt.model": this.model || "unknown", ...properties }, { "chatgpt.questionCounter": this.questionCounter });
		//console.debug(eventName, { "chatgpt.loginMethod": this.loginMethod!, "chatgpt.authType": this.authType!, "chatgpt.model": this.model || "unknown", ...properties }, { "chatgpt.questionCounter": this.questionCounter });
	}

	private logError(eventName: string): void {
		// You can initialize your telemetry reporter and consume it here - *replaced with console.error to prevent unwanted telemetry logs
		// this.reporter?.sendTelemetryErrorEvent(eventName, { "chatgpt.loginMethod": this.loginMethod!, "chatgpt.authType": this.authType!, "chatgpt.model": this.model || "unknown" }, { "chatgpt.questionCounter": this.questionCounter });
		//console.error(eventName, { "chatgpt.loginMethod": this.loginMethod!, "chatgpt.authType": this.authType!, "chatgpt.model": this.model || "unknown" }, { "chatgpt.questionCounter": this.questionCounter });
	}

	private getRandomId() {
		let text = '';
		const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		for (let i = 0; i < 32; i++) {
			text += possible.charAt(Math.floor(Math.random() * possible.length));
		}
		return text;
	}
	private get systemContext() {
		return `You are ChatGPT helping the User with pair programming.`;
	}

}