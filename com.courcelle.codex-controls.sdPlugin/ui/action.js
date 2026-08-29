(() => {
  "use strict";
  let websocket;
  let inspectorId;
  let actionId;
  let kind = "preset";
  let settings = {};
  let saveTimer;
  let styleCatalog = { builtInStyles: [], customStyles: [] };
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
  };
  const settingKey = {
    model: "models",
    thinking: "thinking",
    preset: "presets",
    shortcut: "shortcuts",
  };
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
          : "preset";
    settings = actionInfo.payload.settings || {};
    const key = settingKey[kind];
    if (!Array.isArray(settings[key]) || settings[key].length === 0)
      settings[key] = structuredClone(defaults[kind]);
    websocket = new WebSocket(`ws://127.0.0.1:${port}`);
    websocket.addEventListener("open", () => {
      websocket.send(
        JSON.stringify({ event: registerEvent, uuid: inspectorId }),
      );
      sendToPlugin({ type: "styles/get" });
      document.querySelector("#intro").textContent =
        kind === "shortcut"
          ? "Add one shortcut for a direct key. Add more shortcuts to cycle in this order."
          : "Add one value for a direct set key. Add more values to cycle in this order.";
      renderDisplayOptions();
      render();
    });
    websocket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.event !== "sendToPropertyInspector") return;
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
    input.required = true;
    input.addEventListener("input", () => {
      value[field] = input.value;
      save();
    });
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
      save();
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
    document.querySelector("#show-title").checked =
      settings.showTitle !== false;
    document.querySelector("#show-next").checked = settings.showNext !== false;
    const modelFontRow = document.querySelector("#model-font-row");
    const thinkingFontRow = document.querySelector("#thinking-font-row");
    const shortcutFontRow = document.querySelector("#shortcut-font-row");
    modelFontRow.hidden = kind === "thinking" || kind === "shortcut";
    thinkingFontRow.hidden = kind === "model" || kind === "shortcut";
    shortcutFontRow.hidden = kind !== "shortcut";
    document.querySelector("#model-font-size").value = validFontSize(
      settings.modelFontSize,
      21,
    );
    document.querySelector("#thinking-font-size").value = validFontSize(
      settings.thinkingFontSize,
      kind === "preset" ? 18 : 21,
    );
    document.querySelector("#shortcut-font-size").value = validFontSize(
      settings.shortcutFontSize,
      18,
    );
  }

  function validFontSize(value, fallback) {
    return Number.isFinite(value)
      ? Math.max(10, Math.min(48, Math.round(value)))
      : fallback;
  }

  function valuePositions(primaryFontSize, secondaryFontSize) {
    const top = settings.showTitle === false ? 10 : 29;
    const bottom = settings.showNext === false ? 134 : 100;
    const center = (top + bottom) / 2;
    if (secondaryFontSize === undefined) return [center];

    const primaryHeight = primaryFontSize * 0.7;
    const secondaryHeight = secondaryFontSize * 0.7;
    const gap = Math.min(
      4,
      Math.max(2, Math.min(primaryFontSize, secondaryFontSize) * 0.12),
    );
    const blockTop = center - (primaryHeight + gap + secondaryHeight) / 2;
    return [
      blockTop + primaryHeight / 2,
      blockTop + primaryHeight + gap + secondaryHeight / 2,
    ];
  }

  function createKeyPreview(value, style) {
    const preview = document.createElement("div");
    preview.className = "key-preview";
    preview.setAttribute("aria-hidden", "true");

    const title = document.createElement("span");
    title.className = "preview-title";
    title.textContent = kind.toUpperCase();

    const current = document.createElement("span");
    current.className = "preview-current";
    current.textContent =
      kind === "thinking"
        ? (value.effort || "medium").toUpperCase()
        : (
            value.label || (kind === "shortcut" ? "REVIEW" : "MODEL")
          ).toUpperCase();
    const primaryFontSize = validFontSize(
      kind === "thinking"
        ? settings.thinkingFontSize
        : kind === "shortcut"
          ? settings.shortcutFontSize
          : settings.modelFontSize,
      kind === "shortcut" ? 18 : 21,
    );
    current.style.fontSize = `${Math.max(
      7,
      Math.round(primaryFontSize * 0.45),
    )}px`;

    const secondary = document.createElement("span");
    secondary.className = "preview-secondary";
    secondary.textContent = (value.effort || "medium").toUpperCase();
    const secondaryFontSize = validFontSize(settings.thinkingFontSize, 18);
    secondary.style.fontSize = `${Math.max(
      7,
      Math.round(secondaryFontSize * 0.45),
    )}px`;
    secondary.hidden = kind !== "preset";
    const [primaryY, secondaryY] = valuePositions(
      primaryFontSize,
      kind === "preset" ? secondaryFontSize : undefined,
    );
    current.style.top = `${(primaryY / 144) * 100}%`;
    secondary.style.top = `${((secondaryY ?? 0) / 144) * 100}%`;

    const divider = document.createElement("span");
    divider.className = "preview-divider";

    const next = document.createElement("span");
    next.className = "preview-next";
    next.textContent =
      kind === "thinking"
        ? "NEXT HIGH"
        : kind === "shortcut"
          ? values().length > 1
            ? "NEXT SHORTCUT"
            : "OPEN CODEX"
          : "NEXT MODEL";

    const dot = document.createElement("span");
    dot.className = "preview-dot";
    preview.append(title, current, secondary, divider, next, dot);

    const backgroundColor = style?.backgroundColor || "#303030";
    const borderColor = style?.borderColor || "#a3a3a3";
    preview.style.background = backgroundColor;
    preview.style.borderColor = borderColor;
    preview.style.color = style?.fontColor || "#f5f5f5";
    divider.style.background = borderColor;
    dot.style.background = borderColor;
    title.hidden = settings.showTitle === false;
    divider.hidden = settings.showNext === false;
    next.hidden = settings.showNext === false;
    dot.hidden = settings.showNext === false;
    return preview;
  }

  function styleRow(container, value, index) {
    const row = document.createElement("div");
    row.className = "style-field";
    const labelElement = document.createElement("label");
    labelElement.textContent = "Colors";
    const styles = allStyles();
    if (!value.styleId) {
      value.styleId =
        styleCatalog.builtInStyles[index % 16]?.id ||
        builtInStyleIds[index % builtInStyleIds.length];
      save();
    }

    const selectedStyle = styles.find((style) => style.id === value.styleId);
    const picker = document.createElement("details");
    picker.className = "style-picker";
    const summary = document.createElement("summary");
    const selectedName = document.createElement("span");
    selectedName.className = "selected-style-name";
    selectedName.textContent = selectedStyle?.name || "Unavailable preset";
    summary.append(selectedName, createKeyPreview(value, selectedStyle));
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
          option.append(createKeyPreview(value, style), name);
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
    const container = document.querySelector("#choices");
    container.replaceChildren();
    values().forEach((value, index) => {
      const choice = document.createElement("section");
      choice.className = "choice";
      if (kind === "shortcut") {
        shortcutRow(choice, value);
        inputRow(choice, "Label", "label", value, "Short key label");
      } else if (kind !== "thinking")
        inputRow(
          choice,
          kind === "preset" ? "Model label" : "Label",
          "label",
          value,
          kind === "preset" ? "Sol" : "Short key label",
        );
      if (kind !== "thinking" && kind !== "shortcut")
        inputRow(choice, "Model", "model", value, "gpt-5.6-sol");
      if (kind !== "model" && kind !== "shortcut") thinkingRow(choice, value);
      styleRow(choice, value, index);
      const buttons = document.createElement("div");
      buttons.className = "buttons";
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
      remove.disabled = values().length === 1;
      remove.addEventListener("click", () => {
        values().splice(index, 1);
        render();
        save();
      });
      buttons.append(remove);
      choice.append(buttons);
      container.append(choice);
    });
  }

  document.querySelector("#add").addEventListener("click", () => {
    if (values().length >= 20) return;
    const styleId =
      styleCatalog.builtInStyles[values().length % 16]?.id ||
      builtInStyleIds[values().length % builtInStyleIds.length];
    values().push(
      kind === "model"
        ? { label: "", model: "", styleId }
        : kind === "thinking"
          ? { label: "", effort: "", styleId }
          : kind === "shortcut"
            ? { label: "Review", shortcut: "review", styleId }
            : { label: "", model: "", effort: "", styleId },
    );
    render();
    save();
  });

  for (const [selector, setting] of [
    ["#show-title", "showTitle"],
    ["#show-next", "showNext"],
  ]) {
    document.querySelector(selector).addEventListener("change", (event) => {
      settings[setting] = event.currentTarget.checked;
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
          : setting === "modelFontSize" || kind !== "preset"
            ? 21
            : 18;
      const value = validFontSize(event.currentTarget.valueAsNumber, fallback);
      event.currentTarget.value = value;
      settings[setting] = value;
      render();
      save();
    });
  }

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
