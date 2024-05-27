import { v4 as uuidv4 } from "uuid";
const { createParser } = require('eventsource-parser');

// 聊天接口
export const ONLINE_CHAT_APIKEY = "app-jWmI0bA3AioiorQq6bmU73Ik";
export const ONLINE_CHAT_API = "http://ai.t.vtoone.com/api/v1/chat-messages";
// 代码接口
export const ONLINE_CODE_APIKEY = "app-HZSqJWyZI6xjqkbyXUIcLErR";
export const ONLINE_CODE_API = "http://ai.t.vtoone.com/api/v1/completion-messages";
//export const ONLINE_CODE_APIKEY = "app-app-OU5P1wr9ErUs0VBsuK5CBk5I";
//export const ONLINE_CODE_API = "http://10.1.30.43:5001/v1/completion-messages";

export default class ChatApi2 {
    private requestConfig;
    private apiUrl: string;
    private callBackResult;
    private abortController: AbortController | undefined;
    private isDone: boolean = false;

    constructor(options: any) {
        let { abortSignal, abortController, timeoutMs = 60 * 1000, chatType = "chat" } = options;

        if (timeoutMs && !abortSignal) {
            abortController = new AbortController();
            abortSignal = abortController.signal;
        }
        this.abortController = abortController;
        // 创建axios配置
        this.requestConfig = {
            method: 'post',
            timeout: timeoutMs,
            signal: abortSignal,
            abortController,
            responseType: "stream",
            headers: this.getRequestHeader(chatType === "code"
                ? ONLINE_CODE_APIKEY : ONLINE_CHAT_APIKEY)
        };
        //if (import.meta.env.MODE === 'production')
        this.apiUrl = chatType === "code" ? ONLINE_CODE_API : ONLINE_CHAT_API;
        // else
        //     this.apiUrl = chatType === "code" ? "/completion-messages" : "/chat-messages";
        // 创建调用结果对象
        this.callBackResult = {
            role: "assistant",
            id: uuidv4(),
            text: "",
            error: "",
        };
    }

    /**
     * 取消请求
     */
    abort() {
        try {
            if (this.abortController) {
                this.abortController?.abort();
            }
        } catch (error) {
            console.error(error);
        }
        this.abortController = undefined;
    }

    /**
     * 获取结果
     * @returns 结果
     */
    getCallBackResult() {
        return this.callBackResult || {};
    }

    /**
     * post到服务器
     * @param {url} url 
     * @param {数据} data 
     * @param {进度回调} onProgress 
     * @param {完成回调} onDone 
     */
    async postToServer(url: string, data: any, onProgress: any, onDone: any) {
        data.requestId = this.callBackResult.id;

        //sse 解析器
        const sseParser = this.createSseParser(onProgress, onDone, data);
        let timoutTask;
        try {
            //超时处理
            timoutTask = setTimeout(() => this.abort(), this.requestConfig.timeout);

            //请求
            let response: Response = await fetch(url || this.apiUrl, {
                body: this.getRequestDataJson(data),
                ...this.requestConfig
            });

            if (!response.ok) {
                throw new Error(`无法连接到服务器：${response.status}-${response.statusText}`);
            }
            if (response.body === null) {
                throw new Error(`响应response.body: 空`);
            }
            const textDecoder = response.body.pipeThrough(new TextDecoderStream()).getReader();
            while (true) {
                const { done, value } = await textDecoder.read();
                console.log("textDecoder.read():" + value);
                if (done) {
                    this.isDone = true;
                    break;
                }
                sseParser.feed(value);
            }

            if (!this.isDone) {
                this.fireDone(onDone);
            }
        } catch (error: any) {
            console.log(error);
            this.callBackResult.error = "服务异常: " + error.message;
            this.fireDone(onDone);
        }
        if (timoutTask) {
            clearTimeout(timoutTask);
        }
    }

    /**
     * sse解析器
     * @param {进度} onProgress 
     * @returns 
     */
    createSseParser(onProgress: any, onDone: any, data: any) {
        let notOnline = data && data.useOnline === false;
        return createParser((sseEvent: any) => {
            if (sseEvent.type !== 'event') {
                return;
            }
            const { event, answer, message } = this.responseDataParser(sseEvent, !notOnline);
            console.log("SseParser-> " + event + ":" + answer);
            if (event === 'message') {
                this.callBackResult.text = answer;
                onProgress?.(this.callBackResult);
            } else if (event === "message_end") {
                this.fireDone(onDone);
            } else if (event === "error") {
                console.log("SseParser->error--->: " + message);
                this.callBackResult.error = message;
                this.fireDone(onDone);
            }
        });
    }

    fireDone(onDone: any) {
        this.callBackResult.text = "";
        this.isDone = true;
        onDone?.(this.callBackResult);
    }

    /**
     * 响应数据二次解析
     * @param {响应数据} data 
     * @returns 
     */
    responseDataParser(sseEvent: any, useOnline: boolean) {
        if (useOnline) {
            try {
                return JSON.parse(sseEvent.data);
            }
            catch (error) {
                console.error(error);
            }
            return;
        }
        return { event: sseEvent.event, answer: sseEvent.data, message: sseEvent.data };
    }

    /**
     * 添加请求头
     * @param {Authorization} api_key 
     * @returns 
     */
    getRequestHeader(api_key: string) {
        let headers = {
            'Authorization': `Bearer ${api_key}`,
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream'
        };
        return headers;
    }

    /**
     * 获取请求数据
     * @param {请求数据} originData 
     * @returns 
     */
    getRequestData(originData: any) {
        if (originData.useOnline === false) {
            return originData;
        }

        let { chatType, lang, prompt, history, prefixCode, suffixCode, max_length } = originData;
        let query: any = {
            "response_mode": "streaming",
            "conversation_id": "",
            "user": "abc-123"
        };
        if (chatType === "code") {
            query.inputs = { "prefix_code": prefixCode, "suffix_code": suffixCode, max_length };
        } else if (chatType === "chat") {
            query.inputs = {};
            let promptMessages: any[] = query.query = [];

            promptMessages.push(
                { role: "system", content: 'You are a helpful assistant. 请用中文回答，你的名字叫"同望编码助手"。' },
            );
            this.buildHistory(history, promptMessages);
            promptMessages.push({ role: "user", content: prompt });
        }
        return query;
    }

    getRequestDataJson(originData: any) {
        const json = JSON.stringify(this.getRequestData(originData));
        return json;
    }

    /**
     * 组装历史
     * @param {历史集合} histories [[]...]
     * @param {*} promptMessages 
     */
    buildHistory(histories: any, promptMessages: any) {
        histories && histories.forEach((history: any) => {
            promptMessages.push({ role: history["role"], content: history["content"] });
        });
    }
}