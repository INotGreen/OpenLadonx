import { useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import Eye from "lucide-react/dist/esm/icons/eye";
import EyeOff from "lucide-react/dist/esm/icons/eye-off";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Plus from "lucide-react/dist/esm/icons/plus";
import Power from "lucide-react/dist/esm/icons/power";
import X from "lucide-react/dist/esm/icons/x";
import { ModalShell } from "@/features/design-system/components/modal/ModalShell";
import type { CustomApiConfig } from "@/types";

type ApiProtocol = "response" | "messages";

type CreateApiKeyPayload = {
  name?: string | null;
  baseUrl: string;
  apiKey: string;
  models: string[];
  apiType: ApiProtocol;
};

type TestApiKeyPayload = {
  baseUrl: string;
  apiKey: string;
  apiType?: ApiProtocol;
  model?: string;
};

type SettingsApiKeyManagerProps = {
  apiKeysError: string | null;
  apiSourceMode: "default" | "custom";
  customResponseApi: CustomApiConfig | null;
  customMessagesApi: CustomApiConfig | null;
  onTestApiKey: (request: TestApiKeyPayload) => Promise<unknown>;
  onSaveCustomResponseApi: (config: CustomApiConfig) => Promise<void>;
  onSaveCustomMessagesApi: (config: CustomApiConfig) => Promise<void>;
  onApplyCustomApi: (protocol: ApiProtocol, config: CustomApiConfig) => Promise<void>;
};

type ProtocolOption = {
  value: ApiProtocol;
  label: string;
  endpoint: string;
  placeholder: string;
};

type AddModelFormState = {
  baseUrl: string;
  apiKey: string;
  modelDraft: string;
  models: string[];
};

type SavedConfigEntry = {
  protocol: ApiProtocol;
  label: string;
  config: CustomApiConfig | null;
};

type ApiKeyModalState =
  | { mode: "create" }
  | { mode: "edit"; protocol: ApiProtocol; label: string; config: CustomApiConfig };

const RESPONSE_PROTOCOL_OPTION: ProtocolOption = {
  value: "response",
  label: "OpenAI/Response",
  endpoint: "/v1/responses",
  placeholder: "https://api.example.com/v1/responses",
};

const MESSAGES_PROTOCOL_OPTION: ProtocolOption = {
  value: "messages",
  label: "Anthropic/Messages",
  endpoint: "/v1/messages",
  placeholder: "https://api.example.com/v1/messages",
};

const PROTOCOL_OPTIONS: ProtocolOption[] = [
  RESPONSE_PROTOCOL_OPTION,
  MESSAGES_PROTOCOL_OPTION,
];

const PROTOCOL_OPTION_BY_VALUE: Record<ApiProtocol, ProtocolOption> = {
  response: RESPONSE_PROTOCOL_OPTION,
  messages: MESSAGES_PROTOCOL_OPTION,
};

const createInitialFormState = (config?: CustomApiConfig): AddModelFormState => ({
  baseUrl: config?.baseUrl ?? "",
  apiKey: config?.apiKey ?? "",
  modelDraft: "",
  models: uniqueModels(config?.models ?? []),
});

const parseModels = (value: string) =>
  value
    .split(/[\n,，]/)
    .map((model) => model.trim())
    .filter(Boolean);

const uniqueModels = (models: string[]) =>
  Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)));

const readTextFromContent = (content: unknown): string => {
  if (typeof content === "string" && content) {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  for (const part of content) {
    if (typeof part === "string" && part) {
      return part;
    }
    if (!part || typeof part !== "object") {
      continue;
    }
    const obj = part as { type?: string; text?: unknown };
    if ((obj.type === "text" || obj.type === "output_text") && typeof obj.text === "string") {
      return obj.text;
    }
  }
  return "";
};

const readTestReply = (value: unknown): string => {
  if (!value || typeof value !== "object") {
    return "";
  }
  const response = (value as { response?: unknown }).response;
  const body = (response && typeof response === "object" ? response : value) as Record<string, unknown>;
  if (typeof body.output_text === "string" && body.output_text) {
    return body.output_text;
  }
  const choices = body.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const message = (choices[0] as { message?: { content?: unknown } }).message;
    const reply = readTextFromContent(message?.content);
    if (reply) {
      return reply;
    }
  }
  const output = body.output;
  if (Array.isArray(output)) {
    for (const item of output) {
      const reply = readTextFromContent((item as { content?: unknown }).content);
      if (reply) {
        return reply;
      }
    }
  }
  return readTextFromContent(body.content);
};

const readTestModels = (value: unknown): string[] => {
  if (!value || typeof value !== "object") {
    return [];
  }
  const models = (value as { models?: unknown }).models;
  if (!Array.isArray(models)) {
    return [];
  }
  return uniqueModels(models.filter((model): model is string => typeof model === "string"));
};

const readTestError = (value: unknown): string => {
  const response = (value as { response?: unknown })?.response;
  const error = (response as { error?: unknown })?.error;
  if (typeof error === "string" && error) {
    return error;
  }
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) {
      return message;
    }
  }
  const message = (response as { message?: unknown })?.message;
  return typeof message === "string" ? message : "";
};

function AddModelModal({
  initialConfig,
  initialProtocol = "response",
  isEditing = false,
  protocolLabel,
  onCancel,
  onSave,
  onTest,
}: {
  initialConfig?: CustomApiConfig;
  initialProtocol?: ApiProtocol;
  isEditing?: boolean;
  protocolLabel?: string;
  onCancel: () => void;
  onSave: (request: CreateApiKeyPayload) => Promise<void>;
  onTest: (request: TestApiKeyPayload) => Promise<unknown>;
}) {
  const [protocol, setProtocol] = useState<ApiProtocol>(initialProtocol);
  const [form, setForm] = useState<AddModelFormState>(() => createInitialFormState(initialConfig));
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<"idle" | "ok" | "error">("idle");
  const [testOutput, setTestOutput] = useState("");

  const draftModels = useMemo(() => parseModels(form.modelDraft), [form.modelDraft]);
  const savedModels = useMemo(() => uniqueModels(form.models), [form.models]);
  const allModels = useMemo(() => uniqueModels([...form.models, ...draftModels]), [draftModels, form.models]);
  const selectedProtocol = PROTOCOL_OPTION_BY_VALUE[protocol];

  const addDraftModels = () => {
    if (draftModels.length === 0) {
      return;
    }
    setForm((current) => ({
      ...current,
      modelDraft: "",
      models: uniqueModels([...current.models, ...draftModels]),
    }));
  };

  const removeModel = (model: string) => {
    setForm((current) => ({
      ...current,
      models: current.models.filter((entry) => entry !== model),
    }));
  };

  const handleModelKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addDraftModels();
    }
  };

  const validateForm = () => {
    const baseUrl = form.baseUrl.trim();
    const apiKey = form.apiKey.trim();
    if (!baseUrl) {
      return "请填写接口地址";
    }
    if (!apiKey) {
      return "请填写 API Key";
    }
    if (allModels.length === 0) {
      return "请至少填写一个模型名称";
    }
    return null;
  };

  const testModel = async () => {
    const error = validateForm();
    if (error) {
      setFormError(error);
      return;
    }
    setIsTesting(true);
    setFormError(null);
    setTestStatus("idle");
    setTestOutput("测试中...");
    try {
      const result = await onTest({
        baseUrl: form.baseUrl.trim(),
        apiKey: form.apiKey.trim(),
        apiType: protocol,
        model: allModels[0],
      });
      const status = result as { ok?: boolean; status?: number };
      const ok = status.ok === true || status.status === 200;
      setTestStatus(ok ? "ok" : "error");
      if (!ok) {
        const message = readTestError(result) || (status.status ? `请求失败 (HTTP ${status.status})` : "请求失败");
        setFormError(message);
        setTestOutput(message);
        return;
      }
      const models = readTestModels(result);
      if (models.length > 0) {
        setForm((current) => ({ ...current, models: uniqueModels([...current.models, ...models]) }));
      }
      setTestOutput(readTestReply(result) || JSON.stringify(result, null, 2));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFormError(message);
      setTestOutput(message);
      setTestStatus("error");
    } finally {
      setIsTesting(false);
    }
  };

  const saveModel = async () => {
    const error = validateForm();
    if (error) {
      setFormError(error);
      return;
    }
    setIsSaving(true);
    setFormError(null);
    try {
      await onSave({
        name: allModels[0],
        baseUrl: form.baseUrl.trim(),
        apiKey: form.apiKey.trim(),
        models: allModels,
        apiType: protocol,
      });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ModalShell
      className="settings-api-key-modal"
      cardClassName="settings-api-key-modal-card"
      ariaLabel={isEditing ? "编辑模型" : "添加模型"}
      onBackdropClick={onCancel}
    >
      <div className="settings-api-key-modal-header">
        <div className="settings-api-key-modal-title-row">
          <div className="settings-api-key-modal-title">{isEditing ? "编辑模型" : "添加模型"}</div>
          <div className="settings-api-key-modal-pill">
            {isEditing ? protocolLabel ?? selectedProtocol.label : "支持 response / messages 协议 API"}
          </div>
        </div>
        <button
          type="button"
          className="ghost icon-button settings-api-key-modal-close"
          onClick={onCancel}
          aria-label={isEditing ? "关闭编辑模型弹窗" : "关闭添加模型弹窗"}
        >
          <X aria-hidden />
        </button>
      </div>

      <div className="settings-api-key-modal-body">
        <label className="settings-api-key-modal-field" htmlFor="ladonx-custom-model-protocol">
          <span className="settings-field-label">API 格式协议</span>
          <select
            id="ladonx-custom-model-protocol"
            className="settings-input"
            value={protocol}
            onChange={(event) => setProtocol(event.target.value as ApiProtocol)}
          >
            {PROTOCOL_OPTIONS.map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="settings-api-key-modal-field" htmlFor="ladonx-custom-model-url">
          <span className="settings-field-label">接口地址</span>
          <input
            id="ladonx-custom-model-url"
            className="settings-input"
            value={form.baseUrl}
            placeholder={selectedProtocol.placeholder}
            onChange={(event) => setForm((current) => ({ ...current, baseUrl: event.target.value }))}
          />
        </label>

        <label className="settings-api-key-modal-field" htmlFor="ladonx-custom-model-key">
          <span className="settings-field-label">API Key</span>
          <div className="settings-api-key-secret-field">
            <input
              id="ladonx-custom-model-key"
              className="settings-input"
              type={isApiKeyVisible ? "text" : "password"}
              value={form.apiKey}
              placeholder="输入你的 API Key"
              autoComplete="off"
              onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))}
            />
            <button
              type="button"
              className="ghost icon-button"
              onClick={() => setIsApiKeyVisible((visible) => !visible)}
              aria-label={isApiKeyVisible ? "隐藏 API Key" : "显示 API Key"}
              title={isApiKeyVisible ? "隐藏 API Key" : "显示 API Key"}
            >
              {isApiKeyVisible ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
            </button>
          </div>
        </label>

        <label className="settings-api-key-modal-field" htmlFor="ladonx-custom-model-name">
          <span className="settings-field-label">模型名称</span>
          <input
            id="ladonx-custom-model-name"
            className="settings-input"
            value={form.modelDraft}
            placeholder="输入模型参数值，例如 gpt-4o 或 openai/gpt-4o"
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            onBlur={addDraftModels}
            onChange={(event) => setForm((current) => ({ ...current, modelDraft: event.target.value }))}
            onKeyDown={handleModelKeyDown}
          />
        </label>

        {savedModels.length > 0 && (
          <div className="settings-api-key-chip-row" aria-label="已添加模型">
            {savedModels.map((model) => (
              <span className="settings-api-key-chip" key={model}>
                <span className="settings-api-key-chip-label">{model}</span>
                <button
                  type="button"
                  className="settings-api-key-chip-remove"
                  onClick={() => removeModel(model)}
                  aria-label={`移除 ${model}`}
                >
                  <X aria-hidden />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="settings-api-key-protocol-hint">
          当前使用 {selectedProtocol.label} 协议，测试会请求 {selectedProtocol.endpoint}。
        </div>
        {formError && <div className="settings-help settings-help-error">{formError}</div>}
        <textarea
          className={`settings-input settings-api-key-test-output${
            testStatus === "ok" ? " is-ok" : testStatus === "error" ? " is-error" : ""
          }`}
          value={testOutput}
          placeholder="测试输出"
          readOnly
        />
      </div>

      <div className="settings-api-key-dialog-actions">
        <button
          type="button"
          className="ghost settings-api-key-test-button"
          onClick={() => void testModel()}
          disabled={isSaving || isTesting}
        >
          {isTesting ? "测试中..." : "测试"}
        </button>
        <button type="button" className="ghost" onClick={onCancel} disabled={isSaving || isTesting}>
          取消
        </button>
        <button type="button" className="primary" onClick={() => void saveModel()} disabled={isSaving || isTesting}>
          {isSaving ? "保存中..." : isEditing ? "保存修改" : "保存"}
        </button>
      </div>
    </ModalShell>
  );
}

export function SettingsApiKeyManager({
  apiKeysError,
  apiSourceMode,
  customResponseApi,
  customMessagesApi,
  onTestApiKey,
  onSaveCustomResponseApi,
  onSaveCustomMessagesApi,
  onApplyCustomApi,
}: SettingsApiKeyManagerProps) {
  const [modalState, setModalState] = useState<ApiKeyModalState | null>(null);
  const [applyingProtocol, setApplyingProtocol] = useState<ApiProtocol | null>(null);
  const savedConfigs = useMemo(
    () =>
      [
        { protocol: "response" as const, label: "OpenAI/Response", config: customResponseApi },
        { protocol: "messages" as const, label: "Anthropic/Messages", config: customMessagesApi },
      ].filter((entry): entry is SavedConfigEntry & { config: CustomApiConfig } =>
        Boolean(entry.config && entry.config.models.length > 0),
      ),
    [customMessagesApi, customResponseApi],
  );

  const saveCustomModel = async (request: CreateApiKeyPayload) => {
    const config = {
      baseUrl: request.baseUrl,
      apiKey: request.apiKey,
      models: request.models,
    };
    if (request.apiType === "response") {
      await onSaveCustomResponseApi(config);
      return;
    }
    await onSaveCustomMessagesApi(config);
  };

  const applySavedConfig = async (protocol: ApiProtocol, config: CustomApiConfig) => {
    setApplyingProtocol(protocol);
    try {
      await onApplyCustomApi(protocol, config);
    } finally {
      setApplyingProtocol(null);
    }
  };

  return (
    <div className="settings-field settings-api-key-manager">
      <div className="settings-api-key-toolbar">
        <div>
          <div className="settings-field-label">模型</div>
          {apiKeysError && <div className="settings-help settings-help-error">{apiKeysError}</div>}
        </div>
        
      </div>

      <div className="settings-api-key-local-card">
        <div className="settings-api-key-local-copy">
          <div className="settings-api-key-local-title">本地配置文件</div>
          <div className="settings-api-key-local-desc">
            {apiSourceMode === "custom"
              ? "当前使用本地自定义 API 配置，未登录也可以调用第三方模型。"
              : "添加模型后会切换到本地自定义 API 配置，未登录也可以调用第三方模型。"}
          </div>
        </div>
        <button type="button" className="settings-api-key-local-add" onClick={() => setModalState({ mode: "create" })}>
          <Plus aria-hidden />
          添加模型
        </button>
      </div>

      <div className="settings-api-key-saved-title">已保存模型</div>
      {savedConfigs.length > 0 ? (
        <div className="settings-api-key-saved-list">
          {savedConfigs.map((entry) => {
            const config = entry.config;
            if (!config) {
              return null;
            }
            return (
              <div className="settings-api-key-saved-card" key={entry.protocol}>
                <div className="settings-api-key-saved-header">
                  <div>
                    <div className="settings-api-key-saved-name">{entry.label}</div>
                    <div className="settings-api-key-saved-url">{config.baseUrl}</div>
                  </div>
                  <div className="settings-api-key-saved-actions">
                    <span className="settings-api-key-status is-active">
                      {config.models.length} 个模型
                    </span>
                    <button
                      type="button"
                      className="ghost icon-button settings-api-key-apply"
                      onClick={() => void applySavedConfig(entry.protocol, config)}
                      disabled={applyingProtocol !== null}
                      aria-label={`启用 ${entry.label}`}
                      title={`启用 ${entry.label}`}
                    >
                      <Power aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="ghost icon-button settings-api-key-edit"
                      onClick={() =>
                        setModalState({
                          mode: "edit",
                          protocol: entry.protocol,
                          label: entry.label,
                          config,
                        })
                      }
                      aria-label={`编辑 ${entry.label}`}
                      title={`编辑 ${entry.label}`}
                    >
                      <Pencil aria-hidden />
                    </button>
                  </div>
                </div>
                <div className="settings-api-key-chip-row" aria-label={`${entry.label} 已保存模型`}>
                  {config.models.map((model) => (
                    <span className="settings-api-key-chip" key={`${entry.protocol}:${model}`}>
                      <span className="settings-api-key-chip-label">{model}</span>
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="settings-api-key-empty-state">
          <div className="settings-api-key-empty-title">还没有配置自定义模型</div>
          <div className="settings-api-key-empty-desc">
            添加后会保存到 LadonX 本地设置，并出现在聊天模型下拉中。
          </div>
        </div>
      )}

      {modalState && (
        <AddModelModal
          key={modalState.mode === "edit" ? `edit:${modalState.protocol}` : "create"}
          initialConfig={modalState.mode === "edit" ? modalState.config : undefined}
          initialProtocol={modalState.mode === "edit" ? modalState.protocol : "response"}
          isEditing={modalState.mode === "edit"}
          protocolLabel={modalState.mode === "edit" ? modalState.label : undefined}
          onCancel={() => setModalState(null)}
          onSave={async (request) => {
            await saveCustomModel(request);
            setModalState(null);
          }}
          onTest={onTestApiKey}
        />
      )}
    </div>
  );
}
