import { workspace } from "vscode";

const configuration = workspace.getConfiguration("toonecode", undefined);

export const disabledFor = configuration.get("DisabledFor", new Object());
export const disabledLangs = () => {
    const disabledFor = configuration.get("DisabledFor", new Object());
    let disabledLangs = [];
    const keys = Object.keys(disabledFor);
    for (let i = 0; i < keys.length; i++) {
        let key = keys[i];
        if (
            (disabledFor as any)[key] === true ||
            (disabledFor as any)[key] === "true"
        ) {
            disabledLangs.push(key);
        }
    }
    return disabledLangs;
};

//get number of candidates
const candidateNum_str = String(configuration.get("CandidateNum", "1"));
export const candidateNum = parseInt(candidateNum_str);
export const inlineCompletionEnabled = configuration.get("inlineCompletionEnabled", false);
export const completionDelay = configuration.get("CompletionDelay", 0.5);

export const useOnline = true; //使用在线服务器直连。否则使用测试地址
