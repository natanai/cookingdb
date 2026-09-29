import { renderIngredientLines, ingredientDisplay, kitchenEstimateForOption, normalizeUnit, scaleMultiplierForAvailableAmount, unitOptionsFor } from '../recipe-utils.js';

function panArea(pan) {
  if (!pan) return null;
  const shape = (pan.shape || 'rectangle').toLowerCase();
  const width = Number(pan.width);
  if (!Number.isFinite(width) || width <= 0) return null;

  if (shape === 'round') {
    const radius = width / 2;
    return Math.PI * radius * radius;
  }

  if (shape === 'muffin') {
    const cups = Number(pan.cups) || width;
    return Number.isFinite(cups) && cups > 0 ? cups : null;
  }

  const height = Number(pan.height) || (shape === 'square' ? width : null);
  if (!Number.isFinite(height) || height <= 0) return null;
  return width * height;
}

export function setupAvailableIngredientScaling(recipe, state, multiplierInput, rerender) {
  const toggle = document.getElementById('available-scale-toggle');
  const panel = document.getElementById('available-scale-panel');
  const ingredientSelect = document.getElementById('available-scale-ingredient');
  const amountInput = document.getElementById('available-scale-amount');
  const unitSelect = document.getElementById('available-scale-unit');
  const cancelButton = document.getElementById('available-scale-cancel');
  const note = document.getElementById('available-scale-note');
  const error = document.getElementById('available-scale-error');
  const active = document.getElementById('available-scale-active');
  const activeText = document.getElementById('available-scale-active-text');
  const resetButton = document.getElementById('available-scale-reset');

  if (
    !toggle ||
    !panel ||
    !ingredientSelect ||
    !amountInput ||
    !unitSelect ||
    !cancelButton ||
    !note ||
    !error ||
    !active ||
    !activeText ||
    !resetButton
  ) {
    return () => {};
  }

  const defaultMultiplier = Number(recipe.default_base) || 1;

  const currentMultiplier = () => {
    const value = Number(multiplierInput?.value);
    return Number.isFinite(value) && value > 0 ? value : defaultMultiplier;
  };

  const baselineMultiplier = () =>
    state.availableScale?.previousMultiplier ?? currentMultiplier();

  const effectiveBaselineMultiplier = () =>
    baselineMultiplier() * (Number(state.panMultiplier) || 1);

  const cleanIngredientLabel = (entry) =>
    String(entry?.option?.display || entry?.token || 'ingredient')
      .trim()
      .replace(/,\s*.*$/, '');

  const optionIdentity = (entry) =>
    [
      entry?.token || '',
      entry?.option?.ingredient_id || '',
      entry?.option?.option || '',
      entry?.option?.display || '',
    ].join('::');

  const availableEntries = () =>
    renderIngredientLines(recipe, { ...state, recipe })
      .filter((line) => Array.isArray(line.entries) && line.entries.length === 1)
      .map((line) => line.entries[0])
      .filter((entry) => entry?.token && entry?.option?.ratio);

  const amountForUnit = (entry, unit, effectiveMultiplier) => {
    if (!entry?.option || !Number.isFinite(effectiveMultiplier) || effectiveMultiplier <= 0) {
      return null;
    }

    const normalizedTarget = normalizeUnit(unit);
    const normalizedSource = normalizeUnit(entry.option.unit);

    if (normalizedTarget === 'count' && normalizedSource !== 'count') {
      const estimate = kitchenEstimateForOption(
        entry.option,
        effectiveMultiplier,
        state.ingredientPortions,
        state.ingredientUnitFactors
      );
      return Number.isFinite(estimate?.count) ? estimate.count : null;
    }

    const display = ingredientDisplay(entry.option, effectiveMultiplier, normalizedTarget, false);
    return Number.isFinite(display?.displayAmount) ? display.displayAmount : null;
  };

  const unitChoicesForEntry = (entry) => {
    if (!entry?.option) return [];

    const sourceUnit = normalizeUnit(entry.option.unit);
    const baseChoices = unitOptionsFor(sourceUnit).map((choice) => ({ ...choice }));

    if (!baseChoices.length && sourceUnit) {
      baseChoices.push({
        id: sourceUnit,
        label: String(entry.option.unit || sourceUnit),
      });
    }

    if (sourceUnit === 'count') {
      const label = cleanIngredientLabel(entry);
      return baseChoices.map((choice) =>
        choice.id === 'count' ? { ...choice, label: label || 'count' } : choice
      );
    }

    const countEstimate = kitchenEstimateForOption(
      entry.option,
      effectiveBaselineMultiplier(),
      state.ingredientPortions,
      state.ingredientUnitFactors
    );

    if (countEstimate && !baseChoices.some((choice) => choice.id === 'count')) {
      baseChoices.push({
        id: 'count',
        label: `${cleanIngredientLabel(entry)} (count)`,
      });
    }

    return baseChoices;
  };

  const setPanelOpen = (isOpen) => {
    panel.hidden = !isOpen;
    toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  };

  const setError = (message = '') => {
    error.textContent = message;
    error.hidden = !message;
  };

  const refreshNote = (entry) => {
    if (!entry) {
      note.textContent = '';
      return;
    }

    const selectedUnit = unitSelect.value || normalizeUnit(entry.option?.unit);
    const effective = effectiveBaselineMultiplier();
    const prefix = state.availableScale ? 'Before this adjustment' : 'Current recipe';

    if (normalizeUnit(selectedUnit) === 'count' && normalizeUnit(entry.option?.unit) !== 'count') {
      const estimate = kitchenEstimateForOption(
        entry.option,
        effective,
        state.ingredientPortions,
        state.ingredientUnitFactors
      );
      note.textContent = estimate
        ? `${prefix}: ${estimate.text.toLowerCase()}. Count uses the stored kitchen estimate.`
        : '';
      return;
    }

    const display = ingredientDisplay(entry.option, effective, selectedUnit, false);
    note.textContent = display?.text ? `${prefix}: ${display.text}.` : '';
  };

  const refreshUnits = (entry, preferredUnit = null) => {
    const choices = unitChoicesForEntry(entry);
    const previous = preferredUnit || unitSelect.value;
    unitSelect.replaceChildren();

    choices.forEach((choice) => {
      const option = document.createElement('option');
      option.value = choice.id;
      option.textContent = choice.label;
      unitSelect.appendChild(option);
    });

    const activeUnit =
      state.availableScale?.token === entry?.token ? state.availableScale.unit : null;
    const selectedUnit =
      [previous, activeUnit, state.unitSelections?.[entry?.token], entry?.display?.displayUnit, entry?.option?.unit]
        .map((value) => normalizeUnit(value))
        .find((value) => choices.some((choice) => choice.id === value)) ||
      choices[0]?.id ||
      '';

    if (selectedUnit) unitSelect.value = selectedUnit;
    refreshNote(entry);
  };

  const refresh = () => {
    const entries = availableEntries();
    toggle.hidden = entries.length === 0;

    if (!entries.length) {
      setPanelOpen(false);
      active.hidden = true;
      return;
    }

    if (state.availableScale) {
      const constrainedEntry = entries.find((entry) => entry.token === state.availableScale.token);
      if (!constrainedEntry || optionIdentity(constrainedEntry) !== state.availableScale.optionIdentity) {
        state.availableScale = null;
      }
    }

    const currentToken = ingredientSelect.value;
    const preferredToken =
      (entries.some((entry) => entry.token === currentToken) && currentToken) ||
      (entries.some((entry) => entry.token === state.availableScale?.token) && state.availableScale?.token) ||
      entries[0].token;

    ingredientSelect.replaceChildren();
    entries.forEach((entry) => {
      const option = document.createElement('option');
      option.value = entry.token;
      option.textContent = entry.text;
      if (entry.token === preferredToken) option.selected = true;
      ingredientSelect.appendChild(option);
    });

    const selectedEntry = entries.find((entry) => entry.token === ingredientSelect.value) || entries[0];
    refreshUnits(selectedEntry);

    if (state.availableScale) {
      activeText.textContent = `Scaled to fit your ${state.availableScale.label} on hand.`;
      active.hidden = false;
    } else {
      activeText.textContent = '';
      active.hidden = true;
    }
  };

  toggle.addEventListener('click', () => {
    refresh();
    setError('');
    setPanelOpen(panel.hidden);
    if (!panel.hidden) {
      window.requestAnimationFrame(() => ingredientSelect.focus());
    }
  });

  cancelButton.addEventListener('click', () => {
    setError('');
    setPanelOpen(false);
    toggle.focus();
  });

  ingredientSelect.addEventListener('change', () => {
    amountInput.value = '';
    const entry = availableEntries().find((candidate) => candidate.token === ingredientSelect.value);
    refreshUnits(entry, null);
    setError('');
  });

  unitSelect.addEventListener('change', () => {
    amountInput.value = '';
    const entry = availableEntries().find((candidate) => candidate.token === ingredientSelect.value);
    refreshNote(entry);
    setError('');
  });

  amountInput.addEventListener('input', () => setError(''));

  panel.addEventListener('submit', (event) => {
    event.preventDefault();

    const entry = availableEntries().find((candidate) => candidate.token === ingredientSelect.value);
    const availableAmount = Number(amountInput.value);
    const selectedUnit = normalizeUnit(unitSelect.value);

    if (!entry) {
      setError('Choose an ingredient to scale from.');
      return;
    }
    if (!Number.isFinite(availableAmount) || availableAmount <= 0) {
      setError('Enter an amount greater than zero.');
      amountInput.focus();
      return;
    }

    const previousMultiplier = baselineMultiplier();
    const effectiveBeforeConstraint = previousMultiplier * (Number(state.panMultiplier) || 1);
    const requiredAmount = amountForUnit(entry, selectedUnit, effectiveBeforeConstraint);
    const nextMultiplier = scaleMultiplierForAvailableAmount(
      previousMultiplier,
      requiredAmount,
      availableAmount
    );

    if (!Number.isFinite(nextMultiplier) || nextMultiplier <= 0) {
      setError('This ingredient amount cannot be converted deterministically.');
      return;
    }

    state.availableScale = {
      token: entry.token,
      optionIdentity: optionIdentity(entry),
      label: cleanIngredientLabel(entry),
      amount: availableAmount,
      unit: selectedUnit,
      previousMultiplier,
    };

    if (multiplierInput) {
      multiplierInput.value = nextMultiplier
        .toFixed(12)
        .replace(/\.0+$/, '')
        .replace(/(\.\d*[1-9])0+$/, '$1');
    }

    setError('');
    setPanelOpen(false);
    rerender();
    toggle.focus();
  });

  resetButton.addEventListener('click', () => {
    const previousMultiplier = state.availableScale?.previousMultiplier;
    state.availableScale = null;

    if (multiplierInput && Number.isFinite(previousMultiplier) && previousMultiplier > 0) {
      multiplierInput.value = String(previousMultiplier);
    }

    rerender();
    toggle.focus();
  });

  refresh();
  return refresh;
}

export function setupPanControls(recipe, state, rerender) {
  const panControls = document.getElementById('pan-controls');
  const panSelect = document.getElementById('pan-select');
  const panNote = document.getElementById('pan-note');

  if (!panControls || !panSelect || !panNote) {
    state.panMultiplier = 1;
    return false;
  }

  const panSizes = Array.isArray(recipe?.pan_sizes) ? recipe.pan_sizes : [];
  const validPans = panSizes.filter((pan) => panArea(pan) != null);

  const basePan = validPans.find((p) => p.id === recipe.default_pan) || validPans[0] || null;
  const baseArea = basePan ? panArea(basePan) : null;
  const meaningful =
    validPans.length >= 2 &&
    baseArea &&
    validPans.some((p) => {
      const area = panArea(p);
      return area && Math.abs(area / baseArea - 1) >= 0.01;
    });

  if (panSizes.length && validPans.length === 0) {
    console.warn('Pan sizes ignored: missing dimensions for scaling');
  }

  if (!meaningful || !basePan || !baseArea) {
    state.panMultiplier = 1;
    state.selectedPanId = recipe?.default_pan || null;
    panControls.remove();
    return false;
  }

  panControls.hidden = false;
  panSelect.innerHTML = '';

  const initialPanId = validPans.some((pan) => pan.id === state.selectedPanId)
    ? state.selectedPanId
    : basePan.id;

  validPans.forEach((pan) => {
    const optionEl = document.createElement('option');
    optionEl.value = pan.id;
    optionEl.textContent = pan.label || pan.id;
    if (pan.id === initialPanId) optionEl.selected = true;
    panSelect.appendChild(optionEl);
  });

  const updatePanMultiplier = () => {
    if (state.availableScale) state.availableScale = null;
    const selectedId = panSelect.value || basePan.id;
    state.selectedPanId = selectedId;

    const selectedPan = validPans.find((p) => p.id === selectedId);
    const selectedArea = panArea(selectedPan);

    if (!baseArea || !selectedArea) {
      state.panMultiplier = 1;
      panNote.textContent = 'Pan scaling is unavailable for this recipe.';
      rerender();
      return;
    }

    state.panMultiplier = selectedArea / baseArea;

    const baseLabel = basePan?.label || basePan?.id || 'default pan';
    const selectedLabel = selectedPan?.label || selectedPan?.id || 'selected pan';
    panNote.textContent = `Scaling from ${baseLabel} to ${selectedLabel}.`;

    rerender();
  };

  panSelect.addEventListener('change', updatePanMultiplier);
  updatePanMultiplier();

  return true;
}
