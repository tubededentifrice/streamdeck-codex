(() => {
  "use strict";
  let websocket;
  let inspectorId;
  let actionId;
  let kind = "preset";
  let settings = {};
  let saveTimer;
  let styleCatalog = { builtInStyles: [], customStyles: [] };
  let currentState;
  let recentModels = [];
  let suggestionKey;
  const defaults = {
    model: [
      { label: "Sol", model: "gpt-5.6-sol", styleId: "builtin:ocean" },
      { label: "Luna", model: "gpt-5.6-luna", styleId: "builtin:violet" },
    ],
    thinking: [
      { label: "Medium", effort: "medium", styleId: "builtin:amber" },
      { label: "High", effort: "high", styleId: "builtin:rose" },
    ],
    preset: [
      {
        label: "Sol",
        model: "gpt-5.6-sol",
        effort: "medium",
        styleId: "builtin:ocean",
      },
      {
        label: "Luna",
        model: "gpt-5.6-luna",
        effort: "high",
        styleId: "builtin:violet",
      },
    ],
    shortcut: [
      {
        label: "Review",
        shortcut: "review",
        styleId: "builtin:emerald",
      },
    ],
    single: [
      {
        label: "Sol",
        model: "gpt-5.6-sol",
        effort: "medium",
        styleId: "builtin:ocean",
      },
    ],
  };
  const settingKey = {
    model: "models",
    thinking: "thinking",
    preset: "presets",
    shortcut: "shortcuts",
    single: "presets",
  };
  // A Shortcut or Single Preset key has exactly one value and no cycle.
  const singleValue = () => kind === "shortcut" || kind === "single";
  const shortcutOptions = [
    ["review", "Review"],
    ["terminal", "Terminal"],
    ["browser", "Browser"],
    ["files", "Files"],
    ["side-chat", "Side chat"],
  ];
  const thinkingLevels = [
    "none",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
    "ultra",
  ];
  // The order in which new values take colors. Same as STYLE_CYCLE.
  const builtInStyleIds = [
    "builtin:ocean",
    "builtin:azure",
    "builtin:indigo",
    "builtin:violet",
    "builtin:plum",
    "builtin:rose",
    "builtin:coral",
    "builtin:amber",
    "builtin:lime",
    "builtin:emerald",
    "builtin:teal",
    "builtin:cyan",
    "builtin:slate",
    "builtin:silver",
    "builtin:crimson",
    "builtin:gold",
  ];

  window.connectElgatoStreamDeckSocket = (
    port,
    propertyInspectorId,
    registerEvent,
    info,
    actionInfoJson,
  ) => {
    const actionInfo = JSON.parse(actionInfoJson);
    inspectorId = propertyInspectorId;
    actionId = actionInfo.action;
    kind = actionInfo.action.endsWith(".model")
      ? "model"
      : actionInfo.action.endsWith(".thinking")
        ? "thinking"
        : actionInfo.action.endsWith(".shortcut")
          ? "shortcut"
          : actionInfo.action.endsWith(".single-preset")
            ? "single"
            : "preset";
    settings = actionInfo.payload.settings || {};
    const key = settingKey[kind];
    if (!Array.isArray(settings[key]) || settings[key].length === 0)
      settings[key] = structuredClone(defaults[kind]);
    const settingsBeforeNormalization = JSON.stringify(settings);
    if (kind === "shortcut") {
      const configured = settings[key].find((value) =>
        shortcutOptions.some(([id]) => id === value?.shortcut),
      );
      settings[key] = [configured || structuredClone(defaults.shortcut[0])];
      settings.showNext = false;
    }
    if (kind === "single") {
      const [preset] = settings[key];
      if (preset && typeof preset === "object") delete preset.enabled;
      settings[key] = [preset || structuredClone(defaults.single[0])];
      settings.showNext = false;
      settings.inactiveFade = validFade(settings.inactiveFade);
    }
    const normalizedSettingsChanged =
      settingsBeforeNormalization !== JSON.stringify(settings);
    websocket = new WebSocket(`ws://127.0.0.1:${port}`);
    websocket.addEventListener("open", () => {
      websocket.send(
        JSON.stringify({ event: registerEvent, uuid: inspectorId }),
      );
      sendToPlugin({ type: "styles/get" });
      if (!singleValue()) {
        sendToPlugin({ type: "state/get" });
        window.setInterval(() => sendToPlugin({ type: "state/get" }), 1500);
      }
      const intro = document.querySelector("#intro");
      intro.hidden = kind === "single";
      intro.textContent =
        kind === "shortcut"
          ? "Select the Codex shortcut that this key opens."
          : "Add one value for a direct set key. Add more values to cycle in this order.";
      document.querySelector(".add-row").hidden = singleValue();
      renderDisplayOptions();
      render();
      if (normalizedSettingsChanged) save();
    });
    websocket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.event === "didReceiveSettings") {
        mergeIncoming(message.payload?.settings);
        return;
      }
      if (message.event !== "sendToPropertyInspector") return;
      if (message.payload?.type === "state/current") {
        currentState =
          typeof message.payload.model === "string" &&
          typeof message.payload.effort === "string"
            ? message.payload
            : undefined;
        recentModels = Array.isArray(message.payload.models)
          ? message.payload.models.filter((model) => typeof model === "string")
          : [];
        renderCurrent();
        renderSuggestions();
        return;
      }
      if (message.payload?.type === "styles/catalog") {
        styleCatalog = message.payload;
        render();
        renderStyleManager();
      }
      if (message.payload?.type === "styles/error")
        document.querySelector("#style-error").textContent =
          message.payload.message || "Could not save the color preset.";
    });
  };

  function sendToPlugin(payload) {
    if (websocket?.readyState !== WebSocket.OPEN) return;
    websocket.send(
      JSON.stringify({
        action: actionId,
        context: inspectorId,
        event: "sendToPlugin",
        payload,
      }),
    );
  }

  function values() {
    return settings[settingKey[kind]];
  }

  function comparable(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function isEnabled(value) {
    return value?.enabled !== false;
  }

  function identity(value) {
    if (kind === "model") return comparable(value?.model);
    if (kind === "thinking") return comparable(value?.effort);
    return `${comparable(value?.model)} ${comparable(value?.effort)}`;
  }

  function effortLabel(effort) {
    if (effort === "xhigh") return "Extra high";
    return effort ? effort[0].toUpperCase() + effort.slice(1) : "";
  }

  const modelLabel = (model) => window.CodexPreview.modelLabel(model);

  function currentText() {
    if (!currentState) return "";
    if (kind === "thinking") return currentState.effort;
    if (kind === "model") return currentState.model;
    return `${currentState.model} · ${currentState.effort}`;
  }

  function renderCurrent() {
    const element = document.querySelector("#current");
    const text = currentText();
    element.hidden = !text;
    element.textContent = text;
    element.title = text;
  }

  // Sends the models and thinking levels of a value to the shared catalog,
  // so the plug-in can add them to the other keys as disabled values.
  function shareValue(value) {
    const models =
      kind !== "thinking" && value?.model
        ? [
            {
              label: value.label || modelLabel(value.model),
              model: value.model,
            },
          ]
        : [];
    const efforts =
      kind !== "model" && value?.effort
        ? [
            {
              effort: value.effort,
              label:
                kind === "thinking" ? value.label : effortLabel(value.effort),
            },
          ]
        : [];
    if (models.length || efforts.length)
      sendToPlugin({ type: "catalog/add", efforts, models });
  }

  // Keeps local edits and adds the values that the plug-in linked to this key.
  function mergeIncoming(incoming) {
    const list = incoming?.[settingKey[kind]];
    if (!Array.isArray(list)) return;
    const known = new Set(values().map(identity));
    const added = list.filter((value) => !known.has(identity(value)));
    if (Number.isFinite(incoming.catalogRevision))
      settings.catalogRevision = incoming.catalogRevision;
    if (added.length === 0 || singleValue()) return;
    values().push(...added.map((value) => structuredClone(value)));
    render();
  }
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (websocket?.readyState !== WebSocket.OPEN) return;
      websocket.send(
        JSON.stringify({
          context: inspectorId,
          event: "setSettings",
          payload: settings,
        }),
      );
    }, 150);
  }

  function inputRow(container, label, field, value, placeholder) {
    const row = document.createElement("div");
    row.className = "row";
    const labelElement = document.createElement("label");
    labelElement.textContent = label;
    const input = document.createElement("input");
    input.value = value[field] || "";
    input.placeholder = placeholder;
    input.maxLength = field === "label" ? 32 : 128;
    input.required = field !== "label" || kind === "shortcut";
    input.dataset.field = field;
    input.addEventListener("input", () => {
      value[field] = input.value;
      if (field === "model") {
        const labelInput = row.parentElement?.querySelector(
          'input[data-field="label"]',
        );
        if (labelInput) labelInput.placeholder = modelLabel(input.value);
      }
      refreshPreviews();
      save();
    });
    if (field === "model")
      input.addEventListener("change", () => shareValue(value));
    row.append(labelElement, input);
    container.append(row);
  }

  function thinkingRow(container, value) {
    const row = document.createElement("div");
    row.className = "row";
    const labelElement = document.createElement("label");
    labelElement.textContent = "Thinking";
    const select = document.createElement("select");
    const current = value.effort || "medium";
    value.effort = current;
    const options = thinkingLevels.includes(current)
      ? thinkingLevels
      : [current, ...thinkingLevels];
    for (const effort of options) {
      const option = document.createElement("option");
      option.value = effort;
      option.textContent = effort[0].toUpperCase() + effort.slice(1);
      option.selected = effort === current;
      select.append(option);
    }
    select.addEventListener("change", () => {
      value.effort = select.value;
      refreshPreviews();
      save();
      shareValue(value);
    });
    row.append(labelElement, select);
    container.append(row);
  }

  function shortcutRow(container, value) {
    const row = document.createElement("div");
    row.className = "row";
    const labelElement = document.createElement("label");
    labelElement.textContent = "Shortcut";
    const select = document.createElement("select");
    const current = shortcutOptions.some(([id]) => id === value.shortcut)
      ? value.shortcut
      : "review";
    value.shortcut = current;
    for (const [id, label] of shortcutOptions) {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = label;
      option.selected = id === current;
      select.append(option);
    }
    select.addEventListener("change", () => {
      value.shortcut = select.value;
      const option = shortcutOptions.find(([id]) => id === select.value);
      if (
        !value.label ||
        shortcutOptions.some(([, label]) => label === value.label)
      )
        value.label = option?.[1] || "Open";
      render();
      save();
    });
    row.append(labelElement, select);
    container.append(row);
  }

  function allStyles() {
    return [...styleCatalog.builtInStyles, ...styleCatalog.customStyles];
  }

  function renderDisplayOptions() {
    document.querySelector("#show-title").checked = settings.showTitle === true;
    const fit = settings.fitText !== false;
    document.querySelector("#fit-text").checked = fit;
    document.querySelector("#show-next").checked = settings.showNext !== false;
    document.querySelector("#show-next-row").hidden = singleValue();
    document.querySelector("#fade-row").hidden = kind !== "single";
    document.querySelector("#inactive-fade").value = validFade(
      settings.inactiveFade,
    );
    const modelFontRow = document.querySelector("#model-font-row");
    const thinkingFontRow = document.querySelector("#thinking-font-row");
    const shortcutFontRow = document.querySelector("#shortcut-font-row");
    modelFontRow.hidden = fit || kind === "thinking" || kind === "shortcut";
    thinkingFontRow.hidden = fit || kind === "model" || kind === "shortcut";
    shortcutFontRow.hidden = fit || kind !== "shortcut";
    document.querySelector("#model-font-size").value = validFontSize(
      settings.modelFontSize,
      21,
    );
    document.querySelector("#thinking-font-size").value = validFontSize(
      settings.thinkingFontSize,
      hasPresetLayout() ? 18 : 21,
    );
    document.querySelector("#shortcut-font-size").value = validFontSize(
      settings.shortcutFontSize,
      18,
    );
  }

  function hasPresetLayout() {
    return kind === "preset" || kind === "single";
  }

  // Same default and range as the plug-in key renderer.
  function validFade(value) {
    return Number.isFinite(value)
      ? Math.max(0, Math.min(100, Math.round(value)))
      : 75;
  }

  function validFontSize(value, fallback) {
    return Number.isFinite(value)
      ? Math.max(10, Math.min(48, Math.round(value)))
      : fallback;
  }

  const fallbackStyle = {
    backgroundColor: "#303030",
    borderColor: "#A3A3A3",
    fontColor: "#F5F5F5",
  };

  function withDefaults(value) {
    const model = value?.model || "";
    return {
      effort: value?.effort || "medium",
      label: value?.label || (model ? modelLabel(model) : "Model"),
      model,
    };
  }

  // Draws a value with the plug-in key renderer, as the key shows it while the
  // task uses that value. `inactive` shows a Single Preset key while the task
  // uses other values.
  function previewImage(value, style, inactive) {
    const preview = window.CodexPreview;
    const keyStyle = style || fallbackStyle;
    if (kind === "shortcut")
      return preview.renderShortcutKey(
        {
          label: value.label || "Review",
          shortcut: value.shortcut || "review",
        },
        keyStyle,
        undefined,
        settings,
      );
    const current = withDefaults(value);
    if (kind === "single")
      return preview.renderSingleKey(
        current,
        !inactive,
        keyStyle,
        undefined,
        settings,
      );
    const cycle = values().filter(isEnabled);
    const position = cycle.indexOf(value);
    const target =
      cycle.length > 1 && position >= 0
        ? cycle[(position + 1) % cycle.length]
        : cycle[0];
    return preview.renderKey(
      kind,
      {
        effort: current.effort,
        hostId: "",
        model: current.model,
        threadId: "",
      },
      target && withDefaults(target),
      keyStyle,
      undefined,
      settings,
      current,
    );
  }

  function createKeyPreview(value, style, index, inactive = false) {
    const preview = document.createElement("img");
    preview.className = "key-preview";
    preview.alt = "";
    preview.dataset.choiceIndex = String(index);
    preview.dataset.styleId = style?.id || "";
    if (inactive) preview.dataset.inactive = "true";
    preview.src = previewImage(value, style, inactive);
    return preview;
  }

  function refreshPreviews() {
    document.querySelectorAll(".key-preview").forEach((preview) => {
      const index = Number(preview.dataset.choiceIndex);
      const value = values()[index];
      if (!value) return;
      const style = allStyles().find(
        (item) => item.id === preview.dataset.styleId,
      );
      preview.src = previewImage(
        value,
        style,
        preview.dataset.inactive === "true",
      );
    });
  }

  function styleRow(container, value, index) {
    const row = document.createElement("div");
    row.className = "style-field";
    const labelElement = document.createElement("label");
    labelElement.textContent = "Colors";
    const styles = allStyles();
    if (!value.styleId) {
      value.styleId = builtInStyleIds[index % builtInStyleIds.length];
      save();
    }

    const selectedStyle = styles.find((style) => style.id === value.styleId);
    const picker = document.createElement("details");
    picker.className = "style-picker";
    const summary = document.createElement("summary");
    const selectedName = document.createElement("span");
    selectedName.className = "selected-style-name";
    selectedName.textContent = selectedStyle?.name || "Unavailable preset";
    if (kind === "single") {
      const pair = document.createElement("span");
      pair.className = "preview-pair";
      pair.append(
        createKeyPreview(value, selectedStyle, index),
        createKeyPreview(value, selectedStyle, index, true),
      );
      summary.append(selectedName, pair);
    } else
      summary.append(
        selectedName,
        createKeyPreview(value, selectedStyle, index),
      );
    picker.append(summary);

    const panel = document.createElement("div");
    panel.className = "style-picker-panel";
    const populatePicker = () => {
      if (panel.childElementCount > 0) return;
      for (const [groupLabel, groupStyles] of [
        ["Built in", styleCatalog.builtInStyles],
        ["Custom", styleCatalog.customStyles],
      ]) {
        if (groupStyles.length === 0) continue;
        const heading = document.createElement("div");
        heading.className = "style-group-title";
        heading.textContent = groupLabel;
        const options = document.createElement("div");
        options.className = "style-options";
        for (const style of groupStyles) {
          const option = document.createElement("button");
          option.type = "button";
          option.className = "style-option";
          option.classList.toggle("selected", style.id === value.styleId);
          option.setAttribute(
            "aria-pressed",
            style.id === value.styleId ? "true" : "false",
          );
          const name = document.createElement("span");
          name.textContent = style.name;
          option.append(createKeyPreview(value, style, index), name);
          option.addEventListener("click", () => {
            value.styleId = style.id;
            picker.open = false;
            render();
            save();
          });
          options.append(option);
        }
        panel.append(heading, options);
      }
      if (styles.length === 0) {
        const loading = document.createElement("p");
        loading.textContent = "Loading colors…";
        panel.append(loading);
      }
    };
    picker.addEventListener("toggle", () => {
      if (picker.open) populatePicker();
    });
    picker.append(panel);
    row.append(labelElement, picker);
    container.append(row);
  }

  function render() {
    const scroll = window.scrollY;
    const container = document.querySelector("#choices");
    container.replaceChildren();
    values().forEach((value, index) => {
      const choice = document.createElement("section");
      choice.className = "choice";
      choice.classList.toggle("off", !isEnabled(value));
      if (kind === "shortcut") {
        shortcutRow(choice, value);
        inputRow(choice, "Label", "label", value, "Short key label");
      } else if (kind !== "thinking")
        inputRow(
          choice,
          hasPresetLayout() ? "Model label" : "Label",
          "label",
          value,
          value.model ? modelLabel(value.model) : "Sol",
        );
      if (kind !== "thinking" && kind !== "shortcut")
        inputRow(choice, "Model", "model", value, "gpt-5.6-sol");
      if (kind !== "model" && kind !== "shortcut") thinkingRow(choice, value);
      styleRow(choice, value, index);
      if (singleValue()) {
        container.append(choice);
        return;
      }
      const buttons = document.createElement("div");
      buttons.className = "buttons";
      const cycle = document.createElement("label");
      cycle.className = "cycle";
      cycle.title = "Include this value when the key cycles";
      const enabled = document.createElement("input");
      enabled.type = "checkbox";
      enabled.checked = isEnabled(value);
      enabled.disabled =
        isEnabled(value) && values().filter(isEnabled).length === 1;
      enabled.addEventListener("change", () => {
        if (enabled.checked) delete value.enabled;
        else value.enabled = false;
        render();
        save();
      });
      cycle.append(enabled, "Cycle");
      buttons.append(cycle);
      for (const [text, move] of [
        ["↑", -1],
        ["↓", 1],
      ]) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = text;
        button.title = move < 0 ? "Move up" : "Move down";
        button.disabled = index + move < 0 || index + move >= values().length;
        button.addEventListener("click", () => {
          const target = index + move;
          [values()[index], values()[target]] = [
            values()[target],
            values()[index],
          ];
          render();
          save();
        });
        buttons.append(button);
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.disabled =
        values().length === 1 ||
        (isEnabled(value) && values().filter(isEnabled).length === 1);
      remove.addEventListener("click", () => {
        values().splice(index, 1);
        render();
        save();
      });
      buttons.append(remove);
      choice.append(buttons);
      container.append(choice);
    });
    renderSuggestions();
    window.scrollTo(0, scroll);
  }

  // The models that tasks used and that this key does not have yet.
  function renderSuggestions() {
    const element = document.querySelector("#suggestions");
    const models =
      kind === "model" || kind === "preset"
        ? recentModels.filter(
            (model) =>
              !values().some(
                (value) => comparable(value?.model) === comparable(model),
              ),
          )
        : [];
    const full = values().length >= 20;
    const key = `${full}\n${models.join("\n")}`;
    if (key === suggestionKey) return;
    suggestionKey = key;
    element.replaceChildren(
      ...models.map((model) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "suggestion";
        button.textContent = `+ ${modelLabel(model)}`;
        button.title = model;
        button.disabled = full;
        button.addEventListener("click", () => addValue(model));
        return button;
      }),
    );
    element.hidden = models.length === 0;
  }

  function addValue(model = currentState?.model || "") {
    if (singleValue()) return;
    if (values().length >= 20) return;
    const styleId = builtInStyleIds[values().length % builtInStyleIds.length];
    const effort =
      currentState?.effort && currentState.effort !== "default"
        ? currentState.effort
        : "";
    const value =
      kind === "model"
        ? { label: model ? modelLabel(model) : "", model, styleId }
        : kind === "thinking"
          ? { label: effortLabel(effort), effort, styleId }
          : { label: model ? modelLabel(model) : "", model, effort, styleId };
    if (values().some((item) => identity(item) === identity(value))) {
      value.model = kind === "thinking" ? undefined : "";
      value.effort = kind === "model" ? undefined : "";
      value.label = "";
    }
    values().push(value);
    render();
    save();
    shareValue(value);
    document
      .querySelector("#choices .choice:last-child")
      ?.scrollIntoView({ block: "nearest" });
  }

  document.querySelector("#add").addEventListener("click", () => addValue());

  for (const [selector, setting] of [
    ["#show-title", "showTitle"],
    ["#fit-text", "fitText"],
    ["#show-next", "showNext"],
  ]) {
    document.querySelector(selector).addEventListener("change", (event) => {
      settings[setting] = event.currentTarget.checked;
      renderDisplayOptions();
      render();
      save();
    });
  }

  for (const [selector, setting] of [
    ["#model-font-size", "modelFontSize"],
    ["#thinking-font-size", "thinkingFontSize"],
    ["#shortcut-font-size", "shortcutFontSize"],
  ]) {
    document.querySelector(selector).addEventListener("change", (event) => {
      const fallback =
        setting === "shortcutFontSize"
          ? 18
          : setting === "modelFontSize" || !hasPresetLayout()
            ? 21
            : 18;
      const value = validFontSize(event.currentTarget.valueAsNumber, fallback);
      event.currentTarget.value = value;
      settings[setting] = value;
      render();
      save();
    });
  }

  document
    .querySelector("#inactive-fade")
    .addEventListener("change", (event) => {
      const value = validFade(event.currentTarget.valueAsNumber);
      event.currentTarget.value = value;
      settings.inactiveFade = value;
      render();
      save();
    });

  const customSelect = document.querySelector("#custom-style");
  const styleName = document.querySelector("#style-name");
  const styleBorder = document.querySelector("#style-border");
  const styleBackground = document.querySelector("#style-background");
  const styleFont = document.querySelector("#style-font");

  function renderStyleManager() {
    const selected = customSelect.value;
    customSelect.replaceChildren();
    const newOption = document.createElement("option");
    newOption.value = "";
    newOption.textContent = "New custom preset";
    customSelect.append(newOption);
    for (const style of styleCatalog.customStyles) {
      const option = document.createElement("option");
      option.value = style.id;
      option.textContent = style.name;
      customSelect.append(option);
    }
    customSelect.value = styleCatalog.customStyles.some(
      (style) => style.id === selected,
    )
      ? selected
      : "";
    loadCustomStyle();
  }

  function loadCustomStyle() {
    const style = styleCatalog.customStyles.find(
      (item) => item.id === customSelect.value,
    );
    if (style) {
      styleName.value = style.name;
      styleBorder.value = style.borderColor;
      styleBackground.value = style.backgroundColor;
      styleFont.value = style.fontColor;
    } else {
      styleName.value = "";
      styleBorder.value = "#38bdf8";
      styleBackground.value = "#082f49";
      styleFont.value = "#f0f9ff";
    }
    document.querySelector("#style-update").disabled = !style;
    document.querySelector("#style-delete").disabled = !style;
    document.querySelector("#style-error").textContent = "";
  }

  function editorStyle(id) {
    return {
      ...(id ? { id } : {}),
      name: styleName.value,
      borderColor: styleBorder.value,
      backgroundColor: styleBackground.value,
      fontColor: styleFont.value,
    };
  }

  customSelect.addEventListener("change", loadCustomStyle);
  document
    .querySelector("#style-new")
    .addEventListener("click", () =>
      sendToPlugin({ type: "styles/upsert", style: editorStyle() }),
    );
  document.querySelector("#style-update").addEventListener("click", () =>
    sendToPlugin({
      type: "styles/upsert",
      style: editorStyle(customSelect.value),
    }),
  );
  document
    .querySelector("#style-delete")
    .addEventListener("click", () =>
      sendToPlugin({ type: "styles/delete", id: customSelect.value }),
    );
})();
