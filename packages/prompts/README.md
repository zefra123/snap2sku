# @scope/prompts

识别与描述 prompt 分开维护，并各自版本化：

- `src/recognize.ts` 导出 `PROMPT_VERSION` 和识别 prompt 构造器。
- `src/describe.ts` 导出独立的 `PROMPT_VERSION` 和描述 prompt。
- `src/index.ts` 将两个版本分别命名导出为 `RECOGNIZE_PROMPT_VERSION` 与 `DESCRIPTION_PROMPT_VERSION`，避免聚合导入时重名。

评测报告必须记录实际使用的 `RECOGNIZE_PROMPT_VERSION` 和 `DESCRIPTION_PROMPT_VERSION`。只改其中一类 prompt 时，只递增对应模块的版本。字段与枚举说明从 `@scope/shared` schema 生成，不在 prompt 包中复制字段列表。
