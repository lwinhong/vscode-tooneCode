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

export const csTemplateExplanation=`
# language: C#

public void BubbleSort(int[] arr)
{
    int n = arr.Length;
    for (int i = 0; i < n-1; i++)
    {
        for (int j = 0; j < n-i-1; j++)
        {
            if (arr[j] > arr[j+1])
            {
                int temp = arr[j];
                arr[j] = arr[j+1];
                arr[j+1] = temp;
            }
        }
    }
}

<INPUT>

# Explain the code line by line
public void BubbleSort(int[] arr)
{
    //数组长度
    int n = arr.Length;
    //循环排序
    for (int i = 0; i < n-1; i++)
    {
        for (int j = 0; j < n-i-1; j++)
        {
            //前面的大于后面的，前后交换
            if (arr[j] > arr[j+1])
            {
                //前面的数据临时缓存
                int temp = arr[j];
                //后面的值给前面的赋值
                arr[j] = arr[j+1];
                //把前面的临时数据给后面赋值
                arr[j+1] = temp;
            }
        }
    }
}
# Explain the code line by line
<INPUT:0,1>
`;
