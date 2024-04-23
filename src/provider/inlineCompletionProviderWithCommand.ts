import * as vscode from "vscode";

import getDocumentLanguage from "../utils/getDocumentLanguage";
import { updateStatusBarItem } from "../utils/updateStatusBarItem";
import { disabledFor, enableExtension } from "../param/configures";
import { Trie } from "../trie";
import ChatGptViewProvider from '../toontcode-view-provider';
import chatApi from '../toone-code/chat-api';
import Path from 'path';

let lastRequest = null;
let someTrackingIdCounter = 0;

interface MyInlineCompletionItem extends vscode.InlineCompletionItem {
    trackingId: number;
}
async function completetionEnabled(
    extensionContext: vscode.ExtensionContext,
    editor: vscode.TextEditor
) {
    console.log("new event!");
    const enableExtension = await extensionContext.globalState.get(
        "EnableExtension"
    );
    const isOneCommand = await extensionContext.globalState.get(
        "isOneCommand"
    );

    if (!isOneCommand || !enableExtension) {
        extensionContext.globalState.update("isOneCommand", false);
        extensionContext.globalState.update("DisableInlineCompletion", false);
        return;
    }
    if (!editor) {
        return;
    }

    let selection: vscode.Selection;
    const languageId = editor.document.languageId || "undefined";
    if (
        (disabledFor as any)[languageId] === true ||
        (disabledFor as any)[languageId] === "true" ||
        !isOneCommand
    ) {
        extensionContext.globalState.update("isOneCommand", false);
        extensionContext.globalState.update(
            "DisableInlineCompletion",
            false
        );
        return;
    }
    return true;
}

function requestApi(question: string, lang?: string, chatCodeApi?: chatApi, filePath?: string, laterCode?: string): Promise<any> {
    abortController = new AbortController();
    if (filePath) {
        filePath = Path.basename(filePath);
    }
    return new Promise(async (resolve, reject) => {
        try {
            if (!chatCodeApi) {
                resolve("");
                return;
            }

            let response = "";
            await chatCodeApi.sendMessage(question, {
                abortSignal: abortController.signal,
                stream: true,
                chatType: 'code',
                lang,
                max_length: 512,
                timeoutMs: 40 * 1000,
                filePath,
                laterCode,
                onProgress: (message) => {
                    response += message.text;
                },
                onDone: (message) => {
                    //response = message.text;
                    resolve(response);
                    return false;
                }
            });
        } catch (error) {
            //出错了干点什么
            reject(error);
        }
    });
}

let abortController: AbortController;
export default function inlineCompletionProviderWithCommand(
    g_isLoading: boolean,
    myStatusBarItem: vscode.StatusBarItem,
    reGetCompletions: boolean,
    originalColor: string | vscode.ThemeColor | undefined,
    extensionContext: vscode.ExtensionContext,
    chatCodeApi?: chatApi,
    toontCodeViewProvider?: ChatGptViewProvider) {
    const provider: vscode.InlineCompletionItemProvider = {
        provideInlineCompletionItems: async (
            document,
            position,
            context,
            token
        ) => {

            const editor = vscode.window.activeTextEditor;
            if (!editor || !(await completetionEnabled(extensionContext, editor))) {
                return;
            }
            const cursorPosition = editor.selection.active;
            let selection = new vscode.Selection(
                0,
                0,
                cursorPosition.line,
                cursorPosition.character
            );
            let textBeforeCursor = document.getText(selection);
            if (
                cursorPosition.character === 0 &&
                textBeforeCursor[textBeforeCursor.length - 1] !== "\n"
            ) {
                textBeforeCursor += "\n";
            }
            if (vscode.window.activeNotebookEditor) {
                const cells =
                    vscode.window.activeNotebookEditor.notebook.getCells();
                const currentCell =
                    vscode.window.activeNotebookEditor.selection.start;
                let str = "";
                for (let i = 0; i < currentCell; i++) {
                    str += cells[i].document.getText().trimEnd() + "\n";
                }
                textBeforeCursor = str + textBeforeCursor;
            }
            if (textBeforeCursor.trim() === "") {
                return updateStatusBarItemSuggestion();
            }

            //解决光标之后有除括号空格之外内容，仍然补充造成的调用浪费
            let selectionNextChar: vscode.Selection;

            selectionNextChar = new vscode.Selection(
                cursorPosition.line,
                cursorPosition.character,
                cursorPosition.line,
                cursorPosition.character + 1
            );
            let nextChar = document.getText(selectionNextChar);
            const checkString = "]}) \n\t'\"";
            if (!checkString.includes(nextChar)) {
                return updateStatusBarItemSuggestion();
            } else {
                console.log("continue");
            }

            const isOneCommand = await extensionContext.globalState.get(
                "isOneCommand"
            );
            if (isOneCommand && textBeforeCursor.length > 8) {
                console.log("try to get");
                let requestId = new Date().getTime();
                lastRequest = requestId;
                if (lastRequest !== requestId) {
                    return updateStatusBarItemSuggestion();
                }
                console.log("real to get");
                console.log("new command");

                let lang = getDocumentLanguage(editor);;
                updateStatusBarItem(myStatusBarItem, g_isLoading, true, "");

                abortController?.abort();
                let completion = await requestApi(textBeforeCursor, lang, chatCodeApi, document.fileName);

                if (!completion) {
                    return updateStatusBarItemSuggestion();
                }

                let items = new Array<MyInlineCompletionItem>();
                items.push({
                    insertText: completion,
                    range: new vscode.Range(
                        cursorPosition.translate(0, completion.length),
                        cursorPosition
                    ),
                    trackingId: someTrackingIdCounter++,
                });
                updateStatusBarItemSuggestion("完成");
                return items;
            }

            return updateStatusBarItemSuggestion();
        }
    };

    function updateStatusBarItemSuggestion(msg = "") {
        updateStatusBarItem(myStatusBarItem, g_isLoading, false, msg);
        extensionContext.globalState.update("isOneCommand", false);
        extensionContext.globalState.update(
            "DisableInlineCompletion",
            false
        );
        return { items: [] };
    }

    return provider;
}