export const templateExplanation = `
# language: Python

def sum_squares(lst):
    sum = 0
    for i in range(len(lst)):
        if i % 3 == 0:
            lst[i] = lst[i]**2
        elif i % 4 == 0:
            lst[i] = lst[i]**3
        sum += lst[i]
    return sum

<INPUT>

# Explain the code line by line
def sum_squares(lst):
    # 初始化 sum
    sum = 0
    # 循环遍历列表
    for i in range(len(lst)):
        # 如果索引是3的倍数
        if i % 3 == 0:
            # 求平方
            lst[i] = lst[i]**2
        # 如果索引是4的倍数
        elif i % 4 == 0:
            # 求立方
            lst[i] = lst[i]**3
        # 添加结果到总和
        sum += lst[i]
    # 返回总数量
    return sum
# Explain the code line by line
<INPUT:0,1>`;
