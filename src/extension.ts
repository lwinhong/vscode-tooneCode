// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import ChatGptViewProvider from './toontcode-view-provider.js';
import changeIconColor from "./utils/changeIconColor.js";
import { isCurrentLanguageDisable } from "./utils/isCurrentLanguageDisable.js";
import { enableExtension } from "./param/configures.js";
import getDocumentLanguage from "./utils/getDocumentLanguage.js";

let g_isLoading = false;
let originalColor: string | vscode.ThemeColor | undefined;
let myStatusBarItem: vscode.StatusBarItem;
let provider: ChatGptViewProvider | void;
const menuCommands = ["addTests", "explain", "addComments", "completeCode", "generateCode"];

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	let adhocCommandPrefix: string = context.globalState.get("toonecode-adhoc-prompt") || '';
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "tooneCode" is now active!');

	provider = new ChatGptViewProvider(context);
	const view = vscode.window.registerWebviewViewProvider(
		"toonecode.view",
		provider,
		{
			webviewOptions: {
				retainContextWhenHidden: true,
			},
		}
	);

	// const freeText = vscode.commands.registerCommand("toonecode.freeText", async () => {
	// 	const value = await vscode.window.showInputBox({
	// 		prompt: "请输入提示",
	// 	});

	// 	if (value) {
	// 		provider?.sendApiRequest(value, { command: "freeText" });
	// 	}
	// });

	// /**
	//  * 清理对话
	//  */
	// const resetThread = vscode.commands.registerCommand("toonecode.clearConversation", async () => {
	// 	provider?.sendMessage({ type: 'clearConversation' }, true);
	// });

	// /**
	//  * 导出对话
	//  */
	// const exportConversation = vscode.commands.registerCommand("toonecode.exportConversation", async () => {
	// 	provider?.sendMessage({ type: 'exportConversation' }, true);
	// });

	// /**
	//  * 清理session
	//  */
	// const clearSession = vscode.commands.registerCommand("toonecode.clearSession", () => {
	// 	provider?.clearSession();
	// });

	/**
	 * 配置改变，需要对参试应用
	 */
	const configChanged = vscode.workspace.onDidChangeConfiguration(e => {
		if (e.affectsConfiguration('chatgpt.response.showNotification')) {

		}
	});

	/**
	 * 临时提问
	 */
	const adhocCommand = vscode.commands.registerCommand("toonecode.adhoc", async () => {
		const editor = vscode.window.activeTextEditor;

		if (!editor) {
			return;
		}

		const selection = editor.document.getText(editor.selection);
		let dismissed = false;
		if (selection) {
			await vscode.window
				.showInputBox({
					title: "Add prefix to your ad-hoc command",
					prompt: "Prefix your code with your custom prompt. i.e. Explain this",
					ignoreFocusOut: true,
					placeHolder: "请输入问题",
					value: adhocCommandPrefix
				})
				.then((value) => {
					if (!value) {
						dismissed = true;
						return;
					}

					adhocCommandPrefix = value.trim() || '';
					context.globalState.update("toonecode-adhoc-prompt", adhocCommandPrefix);
				});

			if (!dismissed && adhocCommandPrefix?.length > 0) {
				provider?.sendApiRequest(adhocCommandPrefix, { command: "adhoc", code: selection });
			}
		}
	});
	/**
	 * 生成代码
	 */
	const generateCodeCommand = vscode.commands.registerCommand(`toonecode.generateCode`, () => {
		const editor = vscode.window.activeTextEditor;

		if (!editor) {
			return;
		}

		const selection = editor.document.getText(editor.selection);
		if (selection) {
			provider?.sendApiRequest(selection, { command: "generateCode", chatType: "code", code: " ", language: getDocumentLanguage(editor) });
		}
	});

	vscode.window.onDidChangeTextEditorSelection(e => {
		let text = e.textEditor.document.getText(e.textEditor.selection);
		provider?.sendMessage({ type: 'textSelectionChanged', text, language: e.textEditor.document.languageId }, true);
	});

	if (enableExtension) {
		context.globalState.update("EnableExtension", true);
	} else {
		context.globalState.update("EnableExtension", false);
	}
	const statusBarItemCommandId = "toonecode.disable-enable";
	context.subscriptions.push(
		vscode.commands.registerCommand(statusBarItemCommandId, () => {
			//disableEnable(myStatusBarItem, g_isLoading, originalColor, context);
		})
	);
	myStatusBarItem = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Right,
		100
	);
	myStatusBarItem.command = statusBarItemCommandId;
	context.subscriptions.push(myStatusBarItem);
	changeIconColor(
		enableExtension,
		myStatusBarItem,
		originalColor,
		isCurrentLanguageDisable()
	);

	let inlineProvider: vscode.InlineCompletionItemProvider;
	inlineProvider = provider.inlineCompletionProvider(g_isLoading,
		myStatusBarItem,
		false,
		originalColor,
		context);
	// if (onlyKeyControl) {
	// 	context.globalState.update("DisableInlineCompletion", true);
	// } else {
	context.globalState.update("DisableInlineCompletion", false);
	//context.globalState.update("DisableInlineCompletion", true);
	context.subscriptions.push(
		vscode.languages.registerInlineCompletionItemProvider(
			{ pattern: "**" },
			inlineProvider
		)
	);
	// }

	vscode.commands.registerCommand("toonecode.new-completions", () => {
		context.globalState.update("DisableInlineCompletion", false);
		vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");
		// setTimeout(() => {
		// 	context.globalState.update("DisableInlineCompletion", true);
		// }, 200);
	});

	// let inlineProvider2: vscode.InlineCompletionItemProvider;
	// inlineProvider2 = provider.inlineCompletionProviderWithCommand(g_isLoading,
	// 	myStatusBarItem,
	// 	false,
	// 	originalColor,
	// 	context);
	// let oneTimeDispo: vscode.Disposable;
	// vscode.commands.registerCommand("toonecode.new-completions", () => {
	//     if (oneTimeDispo) {
	//         oneTimeDispo.dispose();
	//     }
	//     context.globalState.update("isOneCommand", true);
	//     context.globalState.update("DisableInlineCompletion", true);
	//     oneTimeDispo = vscode.languages.registerInlineCompletionItemProvider(
	//         { pattern: "**" },
	//         inlineProvider2
	//     );
	// 	vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");
	// });


	//addComments
	const addComments = vscode.commands.registerCommand(`toonecode.addComments`, () => {
		const prompt = vscode.workspace.getConfiguration("toonecode").get<string>(`promptPrefix.addComments`);
		const editor = vscode.window.activeTextEditor;
		if (prompt && editor) {
			//先试着执行，如果执行过了就不再往下了
			const result = false;// provider?.addCommnentGen(editor, myStatusBarItem);
			if (!result) {
				provider?.sendMessageToPage(prompt, {
					command: "addComments", code: editor.document.getText(editor.selection),
					chatType: "",
					filePath: editor.document.fileName,
					language: getDocumentLanguage(editor)
				});
			}
		}
	});
	const addTestsCommand = vscode.commands.registerCommand(`toonecode.addTests`, () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return;
		}
		const selection = editor.document.getText(editor.selection);
		if (selection) {
			const prompt = vscode.workspace.getConfiguration("toonecode").get<string>(`promptPrefix.addTests`) || "";
			provider?.sendMessageToPage(prompt, {
				command: "addTests", chatType: "", code: selection,
				language: getDocumentLanguage(editor),
				filePath: editor.document.fileName
			});
		}
	});
	// Skip AdHoc - as it was registered earlier
	const registeredCommands = menuCommands.filter(command =>
		command !== "addComments" && command !== "addTests" && command !== "adhoc" && command !== "generateCode").map((command) =>
			vscode.commands.registerCommand(`toonecode.${command}`, () => {
				const prompt = vscode.workspace.getConfiguration("toonecode").get<string>(`promptPrefix.${command}`);
				const editor = vscode.window.activeTextEditor;

				if (!editor) {
					return;
				}

				const selection = editor.document.getText(editor.selection);
				if (selection && prompt) {
					provider?.sendMessageToPage(prompt, {
						command, code: selection, language: getDocumentLanguage(editor),
						chatType: "", filePath: editor.document.fileName
					});
				}
			}));


	registeredCommands.push(vscode.commands.registerCommand("toonecode.ask", async () => {
		await provider?.showWebview();
		provider?.sendMessage({ type: 'ask', value: "" });
	}));

	context.subscriptions.push(view, configChanged,
		adhocCommand, addTestsCommand, addComments, generateCodeCommand, ...registeredCommands);

	const setContext = () => {
		menuCommands.forEach(command => {
			// if (command === "generateCode") {
			// 	let generateCodeEnabled = true;// !!vscode.workspace.getConfiguration("chatgpt").get<boolean>("generateCode-enabled");
			// 	// const modelName = vscode.workspace.getConfiguration("chatgpt").get("gpt3.model") as string;
			// 	// const method = vscode.workspace.getConfiguration("chatgpt").get("method") as string;
			// 	// generateCodeEnabled = generateCodeEnabled && method === "GPT3 OpenAI API Key" && modelName.startsWith("code-");
			// 	vscode.commands.executeCommand('setContext', "generateCode-enabled", generateCodeEnabled);
			// } else {
			const enabled = !!vscode.workspace.getConfiguration("toonecode.promptPrefix").get<boolean>(`${command}-enabled`);
			vscode.commands.executeCommand('setContext', `${command}-enabled`, enabled);
			//}
		});
	};
	setContext();
}

// This method is called when your extension is deactivated
export function deactivate() {
	provider?.stopGenerating();
	provider = undefined;
}
