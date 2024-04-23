import axios from "axios";
import { v4 as uuidv4 } from "uuid";

type chatApiError = {
    message: string,
};
type chatApiOption = {
    apiBaseUrl?: string,
    organization?: string,
};
type chatApiSendMessageOptions = {
    stream?: boolean,
    conversationId?: string,
    messageId?: string,
    parentMessageId?: string,
    systemMessage?: string,
    model?: string,
    onProgress?: (partialResponse: ChatMessage) => any,
    onDone?: (response: ChatMessage) => any,
    abortSignal?: AbortSignal,
    timeoutMs?: number,
    chatType?: ChatType,
    historyCount?: number,
    lang?: string,
    max_length?: number,
    cacheHistory?: boolean,
    filePath?: string,
    laterCode?: string,
    url?: string,
};
interface ChatMessage {
    id: string;
    text: string;
    role: Role;
    name?: string;
    delta?: string;
    detail?: any;
    parentMessageId?: string;
    conversationId?: string;
    error?: string;
    history?: any;
};
// type CacheChatMessage = {
//     messageId: string;
//     userMessage?: ChatMessage;
//     assistantMessage?: ChatMessage;
// };
// type HistoryMessages = {
//     history: Array<any>
// };
type Role = 'user' | 'assistant' | 'system';
type ChatType = 'chat' | 'code' | any;

export default class ChatApi {
    //private _cacheChatMessage?: CacheChatMessage[];
    private _historyMessages?: Array<any>;
    private _historyCount: number = 3;
    // private readonly HUMAN_ROLE_START_TAG: string = "<s>human\n";
    // private readonly BOT_ROLE_START_TAG: string = "<s>bot\n";
    // private readonly ENDOFTEXT: string = "<|endoftext|>";
    private readonly RESPONSE_RESULT_BASE64_SPLIT = "<|BASE64_SPLIT|>";
    constructor(opt: chatApiOption) {
        const { apiBaseUrl } = opt;
        //this._historyMessages = new Array();
        axios.defaults.baseURL = apiBaseUrl ?? 'http://codeserver.t.vtoone.com/v1';
        axios.defaults.headers["Content-Type"] = "application/json";
    }

    async sendMessage(text: string, opts: chatApiSendMessageOptions): Promise<ChatMessage> {
        let {
            stream,
            onProgress,
            onDone,
            messageId = uuidv4(),
            timeoutMs = 40 * 1000,
            chatType = "chat",
            historyCount = 3,
            cacheHistory = true,
            url
        } = opts;
        this._historyCount = historyCount;
        let { abortSignal } = opts;
        let abortController = null;
        if (timeoutMs && !abortSignal) {
            abortController = new AbortController();
            abortSignal = abortController.signal;
        }
        // const message: ChatMessage = {
        //     role: "user",
        //     id: messageId,
        //     parentMessageId: messageId,
        //     text
        // };
        const result: ChatMessage = {
            role: "assistant",
            id: uuidv4(),
            parentMessageId: messageId,
            text: "",
            error: ""
        };
        if (!url) {
            if (chatType === "code") {
                url = '/code_generate';
            }
            else {
                url = "/chat";
            }
        }
        let config: axios.AxiosRequestConfig<any> = {
            method: 'post',
            url,
            timeout: timeoutMs,
            signal: abortSignal,
        };
        if (stream) {
            config.responseType = "stream";
            //config.url += "_stream";
            //cacheHistory && await this._updateMessages2(message);

            const requestMsg = await this.buildMessages(text, opts);

            const handler = (response: axios.AxiosResponse<any, any>) => {
                if (onProgress) {
                    response.data.on('data', (chunk: any) => {
                        // 处理流数据的逻辑
                        try {
                            let strSource = chunk.toString() || "";
                            // if (strSource && strSource.indexOf(this.RESPONSE_RESULT_BASE64_SPLIT) >= 0) {
                            //     let str = strSource;//Buffer.from(strSource, 'base64').toString('utf8');
                            //     if (str) {
                            //         let split = str.split(this.RESPONSE_RESULT_BASE64_SPLIT).filter((x: string) => {
                            //             if (x.trim()) {
                            //                 return true;
                            //             }
                            //             return false;
                            //         });
                            //         if (split.length > 0) {
                            //             str = split[split.length - 1];
                            //         }
                            //     } if (!str) {
                            //         str = strSource;
                            //     }
                            //     const json = JSON.parse(str);
                            //     if (json.error) {
                            //         result.error = json.error;
                            //     } else {
                            //         result.text = json.answer;
                            //         if (json.done) {
                            //             result.history = json.history;
                            //         }
                            //     }
                            // } else {
                            //     result.text = strSource;
                            // }
                            if (!strSource) {
                                return;
                            }

                            result.text = strSource;
                            onProgress?.(result);
                        } catch (error) {
                            console.error(error);
                        }
                    });
                }
                if (onDone) {
                    response.data.on('end', async () => {
                        // 数据接收完成的逻辑
                        let rs = onDone?.(result);
                        if (rs === false || result.error) {
                            return;
                        }
                        cacheHistory && await this._updateMessages2(result);
                    });
                }
                response.data.on('error', (error: any) => {
                    if (axios.isCancel(error)) {
                        console.log('请求被取消', error.message);
                    } else {
                        console.log('请求出错', error.message);
                    }
                    result.error = "服务异常，请稍后再试 " + error;
                    onDone?.(result);
                });
            };
            await this.doRequestPost(config, requestMsg).then(handler).catch(err => {
                result.error = "服务异常，请稍后再试. " + err;
                onDone?.(result);
            });
        }
        else {
            const response = await this.doRequestPost(config, {});
            result.text = response.data;
            onDone?.(result);
        }
        return result;
    };

    public async buildMessages(text: string, opts: chatApiSendMessageOptions) {
        const { chatType = "chat", lang } = opts;
        // text+="\n使用中文回答问题";
        let data = { chatType, prompt: text, stream: opts.stream, filePath: opts.filePath, laterCode: opts.laterCode };
        if (chatType === "chat") {
            //text = this.combineMessageWithTAG(text);
            //data.prompt = text;
            data = Object.assign(data, { history: this._historyMessages || [] });
        }
        return data;
    };

    // public combineMessageWithTAG(text: string) {
    //     /**下面这拼接，可以根据历史上下文来不断地回答问题 */
    //     /*
    //         <s>system
    //         这是System指令
    //         <s>human
    //         这是第1轮用户输入的问题
    //         <s>bot
    //         这是第1轮模型生成的内容<|endoftext|>
    //         <s>human
    //         这是第2轮用户输入的问题
    //         <s>bot
    //         这是第2轮模型生成的内容<|endoftext|>
    //         ...
    //         <s>human
    //         这是第n轮用户输入的问题
    //         <s>bot
    //         {模型现在要生成的内容}<|endoftext|>
    //     */
    //     // if (this._cacheChatMessage?.length > 0) {
    //     //     let prompt = "";
    //     //     this._cacheChatMessage.forEach((item, index) => {
    //     //         if (item.userMessage?.text) {
    //     //             prompt += `${this.HUMAN_ROLE_START_TAG}${item.userMessage?.text}`;
    //     //         }
    //     //         if (item.assistantMessage?.text) {
    //     //             prompt += `${this.BOT_ROLE_START_TAG}${item.assistantMessage?.text}${this.ENDOFTEXT}\n`;
    //     //         }
    //     //     });
    //     //     if (prompt) {
    //     //         text = prompt;
    //     //     }
    //     // } else {
    //     //     text = `${this.HUMAN_ROLE_START_TAG}${text}`;
    //     // }
    //     //text = `${text}\n${this.BOT_ROLE_START_TAG}`;
    //     text = `${this.HUMAN_ROLE_START_TAG}${text}\n${this.BOT_ROLE_START_TAG}`;
    //     return text;
    // }
    private async _updateMessages2(message: ChatMessage): Promise<any> {
        return new Promise((resolve, reject) => {

            this._historyMessages = message.history;
            //超出指定范围，需要清理掉一下
            if (this._historyMessages && this._historyMessages.length > this._historyCount) {
                while (this._historyMessages.length > this._historyCount) {
                    this._historyMessages.splice(0, 1);
                }
            }
            resolve(void 0);
        });
    }

    public async clearCacheMessage(): Promise<any> {
        this._historyMessages = undefined;
    }

    private doRequestPost(config: axios.AxiosRequestConfig<any>, data: any): Promise<axios.AxiosResponse<any, any>> {
        return axios.post(config.url || "", data, config);
    }
}
