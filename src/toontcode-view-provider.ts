import * as vscode from 'vscode';
import CodeGenByTemplateUtil from './utils/codeGenByTemplateUtil.js';
import chatApi from './toone-code/chat-api.js';
// import inlineCompletionProvider from "./provider/inlineCompletionProvider";
import inlineCompletionProvider1 from "./provider/inlineCompletionProvider1";
import inlineCompletionProviderWithCommand from "./provider/inlineCompletionProviderWithCommand.js";
import { useModel } from "./param/configures.js";
import Path from 'path';

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
					this.sendApiRequest(data.value, { command: "freeText", conversationId: data.conversationId });
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
					this.chatCodeApi?.clearCacheMessage();
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
		// const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.js'));
		// const stylesMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.css'));

		// const vendorHighlightCss = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vendor', 'highlight.min.css'));
		// const vendorHighlightJs = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vendor', 'highlight.min.js'));
		// const vendorMarkedJs = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vendor', 'marked.min.js'));
		// const vendorTailwindJs = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vendor', 'tailwindcss.3.2.4.min.js'));
		// const vendorTurndownJs = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vendor', 'turndown.js'));

		// const nonce = this.getRandomId();
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

	}

	private login() {
		this.prepareConversation().then(success => {
			if (success) {
				this.sendMessage({ type: 'loginSuccessful', showConversations: this.useAutoLogin }, true);
				this.logEvent("logged-in");
			}
		});
	}
	public async sendMessageToPage(prompt: string, options: {
		command: string, code?: string, previousAnswer?: string,
		language?: string, chatType?: string, conversationId?: string, filePath?: string, laterCode?: string
	}) {
		await this.showWebview();
		this.sendMessage({
			type: "chat_code",
			value: options.code,
			prompt: prompt,
			filePath: options.filePath,
			language: options.language
		});
	}

	private async showWebview() {
		// If the ChatGPT view is not in focus/visible; focus on it to render Q&A
		if (!this.webView) {
			vscode.commands.executeCommand('vscode-toonecode.view.focus');
			await new Promise((resole, reject) => setTimeout(() => {
				resole(true);
			}, 800));
		} else {
			this.webView?.show?.(true);
		}
	}

	public async sendApiRequest(prompt: string, options: {
		command: string, code?: string, previousAnswer?: string,
		language?: string, chatType?: string, conversationId?: string, filePath?: string, laterCode?: string
	}) {
		if (this.inProgress) {
			// The AI is still thinking... Do not accept more questions.
			return;
		}
		let { chatType, filePath, laterCode, conversationId, language } = options;
		this.questionCounter++;
		this.conversationId = conversationId;
		const responseInMarkdown = true;

		this.response = '';
		let question = this.processQuestion(prompt, options.code, language);

		await this.showWebview();

		this.inProgress = true;
		this.abortController = new AbortController();
		//在视图显示进度
		this.sendMessage({ type: 'showInProgress', inProgress: this.inProgress, showStopButton: true });
		this.currentMessageId = this.getRandomId();
		//在视图添加一个问题框
		this.sendMessage({
			type: 'addQuestion', value: prompt, code: options.code, autoScroll: this.autoScroll,
			conversationId, filePath, language, chatType
		});

		if (filePath) {
			filePath = Path.basename(filePath);

		}

		if (this.chatCodeApi) {
			try {
				this.response = "";
				let responseResult = {
					type: 'addResponse', value: "", conversationId, done: false,
					autoScroll: this.autoScroll, responseInMarkdown, currentMessageId: this.currentMessageId
				};
				await this.chatCodeApi.sendMessage(question, {
					systemMessage: this.systemContext,
					messageId: this.conversationId,
					abortSignal: this.abortController.signal,
					stream: true,
					chatType: chatType,
					filePath,
					laterCode,
					onProgress: (message: any) => {
						this.response = message.text;
						responseResult.value = message.text;
						this.sendMessage(responseResult);
					},
					onDone: (message: any) => {
						responseResult.done = true;
						this.sendMessage(responseResult);
						this.inProgress = false;
						this.sendShowInProgress();
					}
				});

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
		this.sendMessage({ type: 'addResponse', value: this.response, done: true, conversationId: this.conversationId, autoScroll: this.autoScroll, responseInMarkdown });
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
			//question = `${question}${language ? ` (The following code is in ${language} programming language)` : ''}: ${code}`;
			if (useModel === "aix") {
				question = `${code}\n${question}`;
			} else {
				question = `${question}${language ? ` (当前编程语言是${language})` : ''}: ${code}`;
			}
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
		return inlineCompletionProvider1(g_isLoading, myStatusBarItem, reGetCompletions, originalColor, extensionContext);
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