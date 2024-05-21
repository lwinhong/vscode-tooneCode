import * as vscode from "vscode";
import { candidateNum, completionDelay, disabledFor } from "../param/configures";

import ChatGptViewProvider from '../toontcode-view-provider';
import ChatApi2 from "../toone-code/chat-api2";
import Path from 'path';
import { updateStatusBarItem } from "../utils/updateStatusBarItem";
import getDocumentLanguage from "../utils/getDocumentLanguage";

let delay: number = completionDelay * 1000;
let lastChatApi2: ChatApi2 | undefined;
let abortController: AbortController;
let lastRequest = null;

const inlineCompletionProvider1 = (
    g_isLoading: boolean,
    myStatusBarItem: vscode.StatusBarItem,
    reGetCompletions: boolean,
    originalColor: string | vscode.ThemeColor | undefined,
    extensionContext: vscode.ExtensionContext,
    toontCodeViewProvider?: ChatGptViewProvider) => {

    let provider2: vscode.InlineCompletionItemProvider = {
        provideInlineCompletionItems: async (document, position, context, token) => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || !(await completetionEnabled(extensionContext, editor))) {
                return;
            }
            cancelLastRequest();
            if (await delayRequest() === false) {
                return;
            }

            let { beforeText, afterText } = getCursorBeforeAfterText(document, editor, position);
            //没有先不执行
            if (!beforeText) {
                updateStatusBarItem2(false);
                return;
            }
            let lang = getDocumentLanguage(editor);
            updateStatusBarItem2(true);

            let items = new Array<vscode.InlineCompletionItem>();
            let completion = await requestApi(beforeText, lang, editor.document.fileName, afterText, afterText ? true : false);
            items.push({
                insertText: completion,
                range: new vscode.Range(
                    position.translate(0, completion.length),
                    position
                ),
            });
            updateStatusBarItem2(false);
            return items;
        },
    };

    function updateStatusBarItem2(show: boolean, msg: string = "") {
        updateStatusBarItem(myStatusBarItem, g_isLoading, show, msg);
    }

    return provider2;
};

const getCursorBeforeAfterText = (document: vscode.TextDocument, editor: vscode.TextEditor, position: vscode.Position) => {
    let selection: vscode.Range = new vscode.Range(0, 0, position.line, position.character);
    let textBeforeCursor = document.getText(selection)?.trim();

    const totalLines = editor.document.lineCount - 1;
    // 获取最后一行的文本,获取最后一行文本的长度（即最后一个字符的索引）
    const lastLineText = editor.document.lineAt(totalLines).text;
    const lastCharacterIndex = lastLineText.length;
    // 获取光标后的文本
    const textAfterCursor = document.getText(new vscode.Range(position.line, position.character, totalLines, lastCharacterIndex))?.trim();
    return { beforeText: textBeforeCursor || "", afterText: textAfterCursor || "" };
};

const delayRequest = async () => {
    console.log("try to get");
    let requestId = new Date().getTime();
    console.log("requestId:" + requestId);
    lastRequest = requestId;
    await new Promise((f) => setTimeout(f, delay));
    if (lastRequest !== requestId) {
        console.log("来太快了");
        return false;
    }
    console.log("real to get");
    console.log("new command");
    return true;
};

const completetionEnabled = async (extensionContext: vscode.ExtensionContext, editor: vscode.TextEditor) => {
    const enableExtension = await extensionContext.globalState.get("EnableExtension");
    const disableInlineCompletion = await extensionContext.globalState.get("DisableInlineCompletion");
    //插件不可用 || inline不可用
    if (!enableExtension || disableInlineCompletion || !editor) {
        return false;
    }

    //语言是否支持
    const language = (disabledFor as any)[editor.document.languageId || "undefined"];
    if (language === true || language === "true" || !enableExtension) {
        //当前语言不支持
        return false;
    }
    return true;
};

const cancelLastRequest = () => {
    lastChatApi2?.abort();
    lastChatApi2 = undefined;
    abortController?.abort();
};

const requestApi = async (question: string, lang?: string,
    filePath?: string, laterCode?: string, fim?: boolean): Promise<any> => {

    if (filePath) {
        filePath = Path.basename(filePath);
    }
    abortController = new AbortController();
    return new Promise(async (resolve, reject) => {
        try {
            let response = "";
            let requesOption: any = {
                abortSignal: abortController.signal,
                chatType: 'code', lang, max_length: 256, filePath,
                prefixCode: question, suffixCode: laterCode,
            };
            const chatApi2 = lastChatApi2 = new ChatApi2(requesOption);
            await chatApi2.postToServer("", requesOption,
                (message: any) => response += message.text,
                (message: any) => {
                    resolve(response);
                    return false;
                });
        } catch (error) {
            //出错了干点什么
            reject(error);
        }
    });
};

export default inlineCompletionProvider1; 