import * as vscode from "vscode";
import {
    candidateNum,
    completionDelay,
    disabledFor,
} from "../param/configures";
import getDocumentLanguage from "../utils/getDocumentLanguage";
import { updateStatusBarItem } from "../utils/updateStatusBarItem";
import { Trie } from "../trie";
import ChatGptViewProvider from '../toontcode-view-provider';
import chatApi from '../toone-code/chat-api';

let lastRequest = null;
let delay: number = completionDelay * 1000;
let trie = new Trie([]);
let prompts: string[] = [];
let someTrackingIdCounter = 0;
interface MyInlineCompletionItem extends vscode.InlineCompletionItem {
    trackingId: number;
}

function middleOfLineWontComplete(editor: any, document: any) {
    const cursorPosition = editor.selection.active;
    let currentLine = document?.lineAt(cursorPosition.line);
    let lineEndPosition = currentLine?.range.end;
    let selectionTrailingString: vscode.Selection;

    selectionTrailingString = new vscode.Selection(
        cursorPosition.line,
        cursorPosition.character,
        cursorPosition.line,
        lineEndPosition.character + 1
    );
    let trailingString = document.getText(selectionTrailingString);
    var re = /^[\]\{\}\); \n\r\t\'\"]*$/;
    if (re.test(trailingString)) {
        return false;
    } else {
        return true;
    }
}

function isAtTheMiddleOfLine(editor: any, document: any) {
    const cursorPosition = editor.selection.active;
    let currentLine = document?.lineAt(cursorPosition.line);
    let lineEndPosition = currentLine?.range.end;
    let selectionTrailingString: vscode.Selection;


    selectionTrailingString = new vscode.Selection(
        cursorPosition.line,
        cursorPosition.character,
        cursorPosition.line,
        lineEndPosition.character + 1
    );
    let trailingString = document.getText(selectionTrailingString);
    let trimmed = trailingString.trim();
    return trimmed.length !== 0;
}

function removeTrailingCharsByReplacement(
    completion: string,
    replacement: string
) {
    for (let ch of replacement) {
        if (!isBracketBalanced(completion, ch)) {
            completion = replaceLast(completion, ch, "");
        }
    }
    return completion;
}
function isBracketBalanced(str: string, character: string) {
    let count = 0;
    for (let ch of str) {
        if (ch === character) {
            count++;
        }
        if (
            (character === "{" && ch === "}") ||
            (character === "[" && ch === "]") ||
            (character === "(" && ch === ")") ||
            (character === "}" && ch === "{") ||
            (character === "]" && ch === "[") ||
            (character === ")" && ch === "(")
        ) {
            count--;
        }
    }
    return count === 0;
}

function replaceLast(str: string, toReplace: string, replacement: string) {
    let pos = str.lastIndexOf(toReplace);
    if (pos > -1) {
        return (
            str.substring(0, pos) +
            replacement +
            str.substring(pos + toReplace.length)
        );
    } else {
        return str;
    }
}
async function completetionEnabled(
    extensionContext: vscode.ExtensionContext,
    editor: vscode.TextEditor
) {
    console.log("new event!");
    const enableExtension = await extensionContext.globalState.get(
        "EnableExtension"
    );
    const disableInlineCompletion = await extensionContext.globalState.get(
        "DisableInlineCompletion"
    );

    if (!enableExtension || disableInlineCompletion || !editor) {
        return false;
    }

    //语言是否支持
    const languageId = editor.document.languageId || "undefined";
    if (
        (disabledFor as any)[languageId] === true ||
        (disabledFor as any)[languageId] === "true" ||
        !enableExtension
    ) {
        return false;
    }
    return true;
}

function requestApi(question: string, lang?: string, chatCodeApi?: chatApi,): Promise<any> {
    abortController = new AbortController();
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
                onProgress: (message) => {
                    //response = message.text;
                },
                onDone: (message) => {
                    response = message.text;
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
export default function inlineCompletionProvider(
    g_isLoading: boolean,
    myStatusBarItem: vscode.StatusBarItem,
    reGetCompletions: boolean,
    originalColor: string | vscode.ThemeColor | undefined,
    extensionContext: vscode.ExtensionContext,
    chatCodeApi?: chatApi,
    toontCodeViewProvider?: ChatGptViewProvider) {

    let provider2: vscode.InlineCompletionItemProvider = {
        provideInlineCompletionItems: async (document,
            position,
            context,
            token) => {

            const editor = vscode.window.activeTextEditor;
            if (!editor || !(await completetionEnabled(extensionContext, editor))) {
                return;
            }

            const cursorPosition = editor.selection.active;

            let selection: vscode.Selection;
            selection = new vscode.Selection(
                0,
                0,
                cursorPosition.line,
                cursorPosition.character
            );
            //获取光标之前的数据
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
            //没有先不执行
            if (textBeforeCursor.trim() === "") {
                updateStatusBarItem(myStatusBarItem, g_isLoading, false, "");
                return;
            }

            //光标在已存在的一行代码中，就不执行
            if (middleOfLineWontComplete(editor, document)) {
                console.log("不进行补充");
                updateStatusBarItem(myStatusBarItem, g_isLoading, false, "");
                return;
            }
            //解决光标之后有除括号空格之外内容，仍然补充造成的调用浪费
            let selectionNextChar: vscode.Selection;
            selectionNextChar = new vscode.Selection(
                cursorPosition.line,
                cursorPosition.character,
                cursorPosition.line,
                cursorPosition.character + 1
            );

            let items = new Array<MyInlineCompletionItem>();

            if (true && !reGetCompletions) {
                for (let prompt of prompts) {
                    if (textBeforeCursor.trimEnd().indexOf(prompt) != -1) {
                        let completions;
                        completions = trie.getPrefix(textBeforeCursor);
                        let useTrim = false;
                        if (completions.length === 0) {
                            completions = trie.getPrefix(
                                textBeforeCursor.trimEnd()
                            );
                            useTrim = true;
                        }
                        if (completions.length == 0) {
                            break;
                        }
                        let items = new Array<MyInlineCompletionItem>();
                        //let lastLine = document.lineAt(document.lineCount - 1);
                        for (
                            let i = 0;
                            i <
                            Math.min(
                                Math.min(completions.length, candidateNum) + 1,
                                completions.length
                            );
                            i++
                        ) {
                            let insertText = useTrim
                                ? completions[i].replace(
                                    textBeforeCursor.trimEnd(),
                                    ""
                                )
                                : completions[i].replace(textBeforeCursor, "");
                            console.log(insertText);
                            let needRequest = ["", "\n", "\n\n"];
                            if (
                                needRequest.includes(insertText) ||
                                insertText.trim() === ""
                            ) {
                                continue;
                            }
                            if (useTrim) {
                                const lines = insertText.split("\n");
                                let nonNullIndex = 0;
                                while (lines[nonNullIndex].trim() === "") {
                                    nonNullIndex++;
                                }
                                let newInsertText = "";
                                for (
                                    let j = nonNullIndex;
                                    j < lines.length;
                                    j++
                                ) {
                                    newInsertText += lines[j];
                                    if (j !== lines.length - 1) {
                                        newInsertText += "\n";
                                    }
                                }
                                if (
                                    textBeforeCursor[
                                    textBeforeCursor.length - 1
                                    ] === "\n" ||
                                    nonNullIndex === 0
                                ) {
                                    insertText = newInsertText;
                                } else {
                                    insertText = "\n" + newInsertText;
                                }
                            }

                            items.push({
                                insertText,
                                range: new vscode.Range(
                                    position.translate(0, completions.length),
                                    position
                                ),
                                // range: new vscode.Range(endPosition.translate(0, completions.length), endPosition),
                                trackingId: someTrackingIdCounter++,
                            });
                            if (useTrim) {
                                trie.addWord(
                                    textBeforeCursor.trimEnd() + insertText
                                );
                            } else {
                                trie.addWord(textBeforeCursor + insertText);
                            }
                        }
                        if (items.length === 0) {
                            continue;
                        } else {
                            updateStatusBarItem(
                                myStatusBarItem,
                                g_isLoading,
                                false,
                                "完成"
                            );
                            return items;
                        }
                    }
                }
            }

            if (textBeforeCursor.length > 8) {
                console.log("try to get");
                let requestId = new Date().getTime();
                console.log("requestId:" + requestId);
                lastRequest = requestId;
                await new Promise((f) => setTimeout(f, delay));
                if (lastRequest !== requestId) {
                    console.log("来太块了");
                    return { items: [] };
                }
                console.log("real to get");
                console.log("new command");

                let lang = getDocumentLanguage(editor);;
                updateStatusBarItem(myStatusBarItem, g_isLoading, true, "");

                abortController?.abort();
                let completion = await requestApi(textBeforeCursor, lang, chatCodeApi);

                if (!completion) {
                    updateStatusBarItem(
                        myStatusBarItem,
                        g_isLoading,
                        false,
                        " No Suggestion"
                    );
                    return { items: [] };
                }
                // let completionTrim =completion.trim();
                // if (completionTrim.startsWith("```")) {
                //     completionTrim = completionTrim.substring(3);
                //     if (completionTrim.endsWith("```") && completionTrim.length > 3) {
                //         completionTrim = completionTrim.substring(0, completionTrim.length - 3);
                //     }
                //     completion = completionTrim;
                // }
                if (isAtTheMiddleOfLine(editor, document)) {
                    const cursorPosition = editor.selection.active;
                    let currentLine = document?.lineAt(cursorPosition.line);
                    let lineEndPosition = currentLine?.range.end;
                    let selectionTrailingString: vscode.Selection;

                    selectionTrailingString = new vscode.Selection(
                        cursorPosition.line,
                        cursorPosition.character,
                        cursorPosition.line,
                        lineEndPosition.character + 1
                    );
                    let trailingString = document.getText(
                        selectionTrailingString
                    );
                    completion = removeTrailingCharsByReplacement(
                        completion,
                        trailingString
                    );
                    if (
                        completion.trimEnd().slice(-1) === "{" ||
                        completion.trimEnd().slice(-1) === ";" ||
                        completion.trimEnd().slice(-1) === ":"
                    ) {
                        completion = completion
                            .trimEnd()
                            .substring(0, completion.length - 1);
                    }
                }

                items.push({
                    insertText: completion,
                    range: new vscode.Range(
                        cursorPosition.translate(0, completion.length),
                        cursorPosition
                    ),
                    trackingId: someTrackingIdCounter++,
                });
                trie.addWord(textBeforeCursor + completion);
                prompts.push(textBeforeCursor);

                updateStatusBarItem(myStatusBarItem, g_isLoading, false, "完成");
            }

            return items;
        }
    };
    return provider2;
}