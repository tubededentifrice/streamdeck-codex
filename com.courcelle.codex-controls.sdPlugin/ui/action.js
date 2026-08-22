(() => {
  "use strict";
  let websocket;
  let inspectorId;
  let kind = "preset";
  let settings = {};
  let saveTimer;
  const defaults = {
    model: [
      { label: "Sol", model: "gpt-5.6-sol" },
      { label: "Luna", model: "gpt-5.6-luna" },
    ],
    thinking: [
      { label: "Medium", effort: "medium" },
      { label: "High", effort: "high" },
    ],
    preset: [
      { label: "Sol · Medium", model: "gpt-5.6-sol", effort: "medium" },
      { label: "Luna · High", model: "gpt-5.6-luna", effort: "high" },
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

  window.connectElgatoStreamDeckSocket = (
    port,
    propertyInspectorId,
    registerEvent,
    info,
    actionInfoJson,
  ) => {
    const actionInfo = JSON.parse(actionInfoJson);
    inspectorId = propertyInspectorId;
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
      render();
    });
  };

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
    values().push(
      kind === "model"
        ? { label: "", model: "" }
        : kind === "thinking"
          ? { label: "", effort: "" }
          : { label: "", model: "", effort: "" },
    );
    render();
    save();
  });
})();
