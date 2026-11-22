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
        renderCurrent();
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

  function modelLabel(model) {
    const gpt = /^gpt-([0-9.]+)-(.+)$/.exec(model);
    if (gpt) return `${gpt[2][0].toUpperCase()}${gpt[2].slice(1)} ${gpt[1]}`;
    const claude = /^claude-([a-z]+)-([0-9-]+)$/.exec(model);
    if (claude)
      return `${claude[1][0].toUpperCase()}${claude[1].slice(1)} ${claude[2].replaceAll("-", ".")}`;
    return model;
  }

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
    input.required = true;
    input.addEventListener("input", () => {
      value[field] = input.value;
      refreshPreviewText();
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
      refreshPreviewText();
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
    document.querySelector("#show-title").checked =
      settings.showTitle !== false;
    document.querySelector("#show-next").checked = settings.showNext !== false;
    document.querySelector("#show-next-row").hidden = singleValue();
    document.querySelector("#fade-row").hidden = kind !== "single";
    document.querySelector("#inactive-fade").value = validFade(
      settings.inactiveFade,
    );
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

  // Mixes a #RRGGBB color toward black, as the unlit key around it.
  function fadeColor(color, fade) {
    const match = /^#([0-9a-f]{6})$/i.exec(color);
    if (!match || fade === 0) return color;
    const value = Number.parseInt(match[1], 16);
    const keep = 1 - fade / 100;
    return `#${[16, 8, 0]
      .map((shift) =>
        Math.round(((value >> shift) & 0xff) * keep)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`;
  }

  function validFontSize(value, fallback) {
    return Number.isFinite(value)
      ? Math.max(10, Math.min(48, Math.round(value)))
      : fallback;
  }

  function keyLayout(showTitle, showNext, primaryFontSize, secondaryFontSize) {
    const titleHeight = 15 * 0.7;
    const primaryHeight = primaryFontSize * 0.7;
    const secondaryHeight =
      secondaryFontSize === undefined ? 0 : secondaryFontSize * 0.7;
    const valueGap =
      secondaryFontSize === undefined
        ? 0
        : Math.min(
            4,
            Math.max(2, Math.min(primaryFontSize, secondaryFontSize) * 0.12),
          );
    const valueHeight = primaryHeight + valueGap + secondaryHeight;
    const footerHeight = 30;
    const sectionCount = 1 + Number(showTitle) + Number(showNext);
    const fixedHeight =
      valueHeight +
      (showTitle ? titleHeight : 0) +
      (showNext ? footerHeight : 0);
    const sectionGap =
      sectionCount === 1
        ? 0
        : Math.max(4, Math.min(22, (128 - fixedHeight) / (sectionCount - 1)));
    const totalHeight = fixedHeight + (sectionCount - 1) * sectionGap;
    let top = 72 - totalHeight / 2;
    let headerCenter;
    if (showTitle) {
      headerCenter = top + titleHeight / 2;
      top += titleHeight + sectionGap;
    }
    const primaryCenter = top + primaryHeight / 2;
    const secondaryCenter =
      secondaryFontSize === undefined
        ? undefined
        : top + primaryHeight + valueGap + secondaryHeight / 2;
    top += valueHeight;
    return {
      footerTop: showNext ? top + sectionGap : undefined,
      headerCenter,
      primaryCenter,
      secondaryCenter,
    };
  }

  function shortcutLayout(labelSize, showTitle) {
    const titleHeight = 15 * 0.7;
    const iconHeight = 56;
    const labelHeight = labelSize * 0.7;
    const totalHeight =
      iconHeight + labelHeight + 4 + (showTitle ? titleHeight + 6 : 0);
    let top = 72 - totalHeight / 2;
    const headerCenter = showTitle ? top + titleHeight / 2 : undefined;
    if (showTitle) top += titleHeight + 6;
    const iconCenter = top + iconHeight / 2;
    top += iconHeight + 4;
    return {
      headerCenter,
      iconOffset: iconCenter - 62,
      labelCenter: top + labelHeight / 2,
    };
  }

  function shortcutIconMarkup(shortcut, color, background) {
    if (shortcut === "terminal")
      return `<polygon points="47,47 66,62 47,77 47,69 57,62 47,55" fill="${color}"/><rect x="67" y="74" width="28" height="6" rx="3" fill="${color}"/>`;
    if (shortcut === "browser")
      return `<circle cx="72" cy="62" r="26" fill="${color}"/><circle cx="72" cy="62" r="20" fill="${background}"/><ellipse cx="72" cy="62" rx="10" ry="23" fill="${color}"/><ellipse cx="72" cy="62" rx="6" ry="20" fill="${background}"/><rect x="47" y="60" width="50" height="4" fill="${color}"/>`;
    if (shortcut === "files")
      return `<polygon points="40,48 65,48 72,55 104,55 104,87 40,87" fill="${color}"/><rect x="46" y="62" width="52" height="19" rx="2" fill="${background}"/>`;
    if (shortcut === "side-chat")
      return `<polygon points="40,43 89,43 89,75 60,75 46,86 46,75 40,75" fill="${color}"/><polygon points="70,57 104,57 104,83 91,83 79,92 79,83 70,83" fill="${color}"/><rect x="75" y="62" width="24" height="16" rx="2" fill="${background}"/>`;
    return `<rect x="41" y="46" width="29" height="35" rx="3" fill="${color}"/><rect x="74" y="46" width="29" height="35" rx="3" fill="${color}"/><rect x="47" y="54" width="17" height="4" rx="2" fill="${background}"/><rect x="47" y="63" width="12" height="4" rx="2" fill="${background}"/><rect x="80" y="54" width="17" height="4" rx="2" fill="${background}"/><rect x="80" y="63" width="12" height="4" rx="2" fill="${background}"/>`;
  }

  function previewTarget(index) {
    const cycle = values().filter(isEnabled);
    const position = cycle.indexOf(values()[index]);
    const target =
      cycle.length > 1 && position >= 0
        ? cycle[(position + 1) % cycle.length]
        : cycle[0];
    if (!target) return "NO CHOICES";
    const prefix = cycle.length > 1 ? "NEXT" : "SET";
    const label =
      kind === "thinking"
        ? target.effort || "medium"
        : kind === "preset"
          ? `${target.label || "MODEL"} / ${target.effort || "medium"}`
          : target.label || "MODEL";
    return `${prefix}  ${label}`.toUpperCase().slice(0, 28);
  }

  function previewPrimary(value) {
    return (
      kind === "thinking"
        ? value.effort || "medium"
        : value.label || (kind === "shortcut" ? "REVIEW" : "MODEL")
    )
      .toUpperCase()
      .slice(0, 18);
  }

  function refreshPreviewText() {
    document.querySelectorAll(".key-preview").forEach((preview) => {
      const index = Number(preview.dataset.choiceIndex);
      const value = values()[index];
      if (!value) return;
      const current = preview.querySelector(".preview-current");
      const secondary = preview.querySelector(".preview-secondary");
      const next = preview.querySelector(".preview-next");
      if (current) current.textContent = previewPrimary(value);
      if (secondary)
        secondary.textContent = (value.effort || "medium").toUpperCase();
      if (next) next.textContent = previewTarget(index);
    });
  }

  // `inactive` shows a Single Preset key while the task uses other values.
  function createKeyPreview(value, style, index, inactive = false) {
    const preview = document.createElement("div");
    preview.className = "key-preview";
    preview.dataset.choiceIndex = String(index);
    preview.setAttribute("aria-hidden", "true");

    const fade = inactive ? validFade(settings.inactiveFade) : 0;
    const backgroundColor = fadeColor(
      style?.backgroundColor || "#303030",
      fade,
    );
    const borderColor = inactive
      ? backgroundColor
      : style?.borderColor || "#a3a3a3";
    const fontColor = fadeColor(style?.fontColor || "#f5f5f5", fade);
    const showTitle = settings.showTitle !== false;
    const showNext = !singleValue() && settings.showNext !== false;

    const title = document.createElement("span");
    title.className = "preview-title";
    title.textContent = kind === "single" ? "PRESET" : kind.toUpperCase();

    const current = document.createElement("span");
    current.className = "preview-current";
    current.textContent = previewPrimary(value);
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
    secondary.hidden = !hasPresetLayout();
    const divider = document.createElement("span");
    divider.className = "preview-divider";

    const next = document.createElement("span");
    next.className = "preview-next";
    next.textContent = previewTarget(index);

    const dot = document.createElement("span");
    dot.className = "preview-dot";
    if (kind === "shortcut") {
      const layout = shortcutLayout(primaryFontSize, showTitle);
      const icon = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
      );
      icon.classList.add("preview-shortcut-icon");
      icon.setAttribute("viewBox", "0 0 144 144");
      icon.style.top = `${(layout.iconOffset / 144) * 100}%`;
      icon.innerHTML = shortcutIconMarkup(
        value.shortcut,
        fontColor,
        backgroundColor,
      );
      title.style.top = `${((layout.headerCenter ?? 0) / 144) * 100}%`;
      current.style.top = `${(layout.labelCenter / 144) * 100}%`;
      preview.append(title, icon, current);
    } else {
      const layout = keyLayout(
        showTitle,
        showNext,
        primaryFontSize,
        hasPresetLayout() ? secondaryFontSize : undefined,
      );
      title.style.top = `${((layout.headerCenter ?? 0) / 144) * 100}%`;
      current.style.top = `${(layout.primaryCenter / 144) * 100}%`;
      secondary.style.top = `${((layout.secondaryCenter ?? 0) / 144) * 100}%`;
      divider.style.top = `${(((layout.footerTop ?? 0) + 1) / 144) * 100}%`;
      next.style.top = `${(((layout.footerTop ?? 0) + 15) / 144) * 100}%`;
      dot.style.top = `${(((layout.footerTop ?? 0) + 27) / 144) * 100}%`;
      preview.append(title, current, secondary, divider, next, dot);
    }

    preview.style.background = backgroundColor;
    preview.style.borderColor = borderColor;
    preview.style.color = fontColor;
    divider.style.background = borderColor;
    dot.style.background = borderColor;
    title.hidden = !showTitle;
    divider.hidden = !showNext;
    next.hidden = !showNext;
    dot.hidden = !showNext;
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
          hasPresetLayout() ? "Sol" : "Short key label",
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
    window.scrollTo(0, scroll);
  }

  document.querySelector("#add").addEventListener("click", () => {
    if (singleValue()) return;
    if (values().length >= 20) return;
    const styleId =
      styleCatalog.builtInStyles[values().length % 16]?.id ||
      builtInStyleIds[values().length % builtInStyleIds.length];
    const model = currentState?.model || "";
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
