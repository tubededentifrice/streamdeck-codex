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
        label: "Sol · Medium",
        model: "gpt-5.6-sol",
        effort: "medium",
        styleId: "builtin:ocean",
      },
      {
        label: "Luna · High",
        model: "gpt-5.6-luna",
        effort: "high",
        styleId: "builtin:violet",
      },
    ],
  };
  const settingKey = {
    model: "models",
    thinking: "thinking",
    preset: "presets",
  };
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

  function allStyles() {
    return [...styleCatalog.builtInStyles, ...styleCatalog.customStyles];
  }

  function styleRow(container, value, index) {
    const row = document.createElement("div");
    row.className = "style-field";
    const labelElement = document.createElement("label");
    labelElement.textContent = "Colors";
    const select = document.createElement("select");
    const styles = allStyles();
    if (!value.styleId) {
      value.styleId =
        styleCatalog.builtInStyles[index % 16]?.id ||
        builtInStyleIds[index % builtInStyleIds.length];
      save();
    }

    for (const [groupLabel, groupStyles] of [
      ["Built in", styleCatalog.builtInStyles],
      ["Custom", styleCatalog.customStyles],
    ]) {
      if (groupStyles.length === 0) continue;
      const group = document.createElement("optgroup");
      group.label = groupLabel;
      for (const style of groupStyles) {
        const option = document.createElement("option");
        option.value = style.id;
        option.textContent = style.name;
        option.selected = style.id === value.styleId;
        group.append(option);
      }
      select.append(group);
    }
    if (!styles.some((style) => style.id === value.styleId)) {
      const option = document.createElement("option");
      option.value = value.styleId;
      option.textContent = "Unavailable preset";
      option.selected = true;
      select.prepend(option);
    }
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    const updateSwatch = () => {
      const style = allStyles().find((item) => item.id === select.value);
      swatch.style.background = style?.backgroundColor || "#0f172a";
      swatch.style.border = `3px solid ${style?.borderColor || "#94a3b8"}`;
      swatch.style.color = style?.fontColor || "#f8fafc";
    };
    select.addEventListener("change", () => {
      value.styleId = select.value;
      updateSwatch();
      save();
    });
    updateSwatch();
    row.append(labelElement, select, swatch);
    container.append(row);
  }

  function render() {
    const container = document.querySelector("#choices");
    container.replaceChildren();
    values().forEach((value, index) => {
      const choice = document.createElement("section");
      choice.className = "choice";
      inputRow(
        choice,
        "Label",
        "label",
        value,
        kind === "preset" ? "Sol · Medium" : "Short key label",
      );
      if (kind !== "thinking")
        inputRow(choice, "Model", "model", value, "gpt-5.6-sol");
      if (kind !== "model") thinkingRow(choice, value);
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
          : { label: "", model: "", effort: "", styleId },
    );
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
