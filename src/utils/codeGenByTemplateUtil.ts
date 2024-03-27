import * as vscode from "vscode";
import { templateExplanation } from "../templates/explanation";
import chatApi from '../toone-code/chat-api';
import { updateStatusBarItem } from "./updateStatusBarItem";
import ChatGptViewProvider from '../toontcode-view-provider';

let abortController: any;
/**
 * 生成注释
 * @param editor 当前编辑器
 * @param templateStr 模板
 * @param myStatusBarItem 状态栏
 * @param g_isLoading 加载中
 * @param chatCodeApi api
 * @returns 
 */
export default function CodeGenByTemplateUtil(
    editor: vscode.TextEditor,
    templateStr: string,
    myStatusBarItem: vscode.StatusBarItem,
    g_isLoading: boolean,
    chatCodeApi?: chatApi,
    toontCodeViewProvider?: ChatGptViewProvider
) {
    if (!chatCodeApi || !editor) { return; }

    async function codeGenByTemplate() {
        try {
            let prompt = buildPrompt(editor, templateStr);
            if (!prompt) {
                return;
            }
            updateStatusBarItem(myStatusBarItem, g_isLoading, true, "");
            let result = await requestApi(prompt);
            if (result) {
                result = result.trimStart("\n");
                const escapedString = (result as string).replace(/\$/g, '\\$');
                editor.insertSnippet(new vscode.SnippetString(escapedString));
            }
            updateStatusBarItem(myStatusBarItem, g_isLoading, false, "Done");
        } catch (error) {
            updateStatusBarItem(myStatusBarItem, g_isLoading, false, " No Suggestion");
        } finally {
            abortController = undefined;
            abortController = null;
        }
    }

    function requestApi(question: string): Promise<any> {
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

    function buildPrompt(editor: vscode.TextEditor,
        templateStr: string) {

        let prompt_input = "\n";
        let document = editor.document;
        let sel = editor.selections;
        for (var x = 0; x < sel.length; x++) {
            let txt: string = document.getText(
                new vscode.Range(sel[x].start, sel[x].end)
            );
            prompt_input += txt;
        }

        templateStr = templateStr ? templateStr : templateExplanation;

        let prompt = "";
        let promptInputArr = prompt_input.split("\n");
        const re = /<INPUT(:.+)?>/g;
        let iter = re.exec(templateStr);
        prompt = templateStr;
        while (iter) {
            if (iter[0] == "<INPUT>") {
                prompt = prompt.replace(iter[0], prompt_input);
            } else if (iter[0].indexOf(":") != -1) {
                if (iter[0].indexOf(",") != -1) {
                    let rangeStr = iter[0].split(":")[1];
                    rangeStr = rangeStr.slice(0, -1);
                    let fromLine = Number(rangeStr.split(",")[0]);
                    let toLine = Number(rangeStr.split(",")[1]);
                    prompt = prompt.replace(
                        iter[0],
                        promptInputArr.slice(fromLine, toLine).join("\n")
                    );
                } else {
                    let rangeStr = Number(iter[0].split(":")[1].slice(0, -1));
                    prompt = prompt.replace(
                        iter[0],
                        promptInputArr.slice(rangeStr).join("\n")
                    );
                }
            } else {
                vscode.window.showInformationMessage(
                    "<INPUT>标签里面存在错误"
                );
                return;
            }
            iter = re.exec(templateStr);
        }
        return prompt;
    }

    abortController?.abort();
    abortController = new AbortController();
    codeGenByTemplate();
} 