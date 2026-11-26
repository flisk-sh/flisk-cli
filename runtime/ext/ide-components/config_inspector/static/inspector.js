// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

// Config Inspector front-end.
// Loaded by the main page after the inline block that sets
// window.PANE_DATA, window.EDIT_MODE, window.SYNC_SCROLL and
// window.CSRF_TOKEN.

// Track dirty state per pane
window.DIRTY_PANES = new Set();

// Handle config tree click with multi-select support
// biome-ignore lint/correctness/noUnusedVariables lint/correctness/noUnusedFunctionParameters: called from server-rendered onclick attributes
function handleConfigClick(event, path, currentSelectionCount) {
  const isMultiSelect = event.ctrlKey || event.metaKey;

  if (isMultiSelect) {
    event.preventDefault();

    // Build new selection
    const currentPaths = window.PANE_DATA ? window.PANE_DATA.map((p) => p.path) : [];
    const index = currentPaths.indexOf(path);

    if (index >= 0) {
      // Deselect
      currentPaths.splice(index, 1);
    } else if (currentPaths.length < 3) {
      // Add to selection (max 3)
      currentPaths.push(path);
    }

    // Navigate to new URL
    const params = currentPaths.map((p, i) => `master${i + 1}=${encodeURIComponent(p)}`);
    const newUrl = params.length > 0 ? `/compare?${params.join("&")}` : "/";
    window.location.href = newUrl;
  } else {
    // Single select - just navigate
    window.location.href = `/compare?master1=${encodeURIComponent(path)}`;
  }
}

// Clear all selections
// biome-ignore lint/correctness/noUnusedVariables: called from a server-rendered onclick attribute
function clearSelection() {
  window.location.href = "/";
}

// Toggle edit mode
function toggleEditMode() {
  if (window.DIRTY_PANES.size > 0) {
    const files = Array.from(window.DIRTY_PANES).map((pane) => {
      const paneData = window.PANE_DATA.find((p) => p.index === pane);
      return paneData ? paneData.path : "Unknown";
    });
    if (
      !confirm(
        `You have unsaved changes in:\n${files.join("\n")}\n\nDiscard changes and exit edit mode?`,
      )
    ) {
      return;
    }
  }

  const url = new URL(window.location);
  const currentEdit = url.searchParams.get("edit") === "true";
  url.searchParams.set("edit", (!currentEdit).toString());
  window.location.href = url.toString();
}

// Toggle sync scroll
// biome-ignore lint/correctness/noUnusedVariables: called from a server-rendered onchange attribute
function toggleSyncScroll() {
  const checkbox = document.getElementById("syncScrollCheckbox");
  const url = new URL(window.location);
  url.searchParams.set("sync", checkbox.checked.toString());
  window.location.href = url.toString();
}

// Save a single pane
async function savePane(paneIndex) {
  const textarea = document.querySelector(`textarea[data-pane="${paneIndex}"]`);
  if (!textarea) return;

  const path = textarea.dataset.path;
  const content = textarea.value;
  const originalHash = textarea.dataset.hash;

  await saveFile(path, content, originalHash, paneIndex);
}

// Save all panes
async function saveAllPanes() {
  const textareas = document.querySelectorAll("textarea.config-editor");
  const results = [];

  for (const textarea of textareas) {
    const paneIndex = Number.parseInt(textarea.dataset.pane, 10);
    const path = textarea.dataset.path;
    const content = textarea.value;
    const originalHash = textarea.dataset.hash;

    const result = await saveFile(path, content, originalHash, paneIndex, false);
    results.push({ paneIndex, success: result.success });
  }

  // Show summary notification
  const successCount = results.filter((r) => r.success).length;
  const totalCount = results.length;

  if (successCount === totalCount) {
    showNotification(`All ${totalCount} files saved successfully`, "success");
    window.DIRTY_PANES.clear();
    updateUnsavedIndicators();
    updateSaveAllButton();
  } else {
    showNotification(`${successCount}/${totalCount} files saved`, "warning");
  }
}

// Save a file via API
async function saveFile(path, content, originalHash, paneIndex, showToast = true) {
  try {
    const response = await fetch("/save", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": window.CSRF_TOKEN,
      },
      body: JSON.stringify({
        path: path,
        content: content,
        original_hash: originalHash,
        csrf_token: window.CSRF_TOKEN,
      }),
    });

    const result = await response.json();

    if (result.success) {
      if (showToast) {
        showNotification(`Saved: ${path}`, "success");
      }

      // Trigger save success animation on the panel
      const panel = document.querySelector(`.pane-${paneIndex}`);
      if (panel) {
        panel.classList.add("save-success");
        setTimeout(() => panel.classList.remove("save-success"), 1000);
      }

      // Clear dirty state for this pane
      window.DIRTY_PANES.delete(paneIndex);
      updateUnsavedIndicators();
      updateSaveAllButton();

      // Update the hash in the textarea
      const textarea = document.querySelector(`textarea[data-pane="${paneIndex}"]`);
      if (textarea && result.new_hash) {
        textarea.dataset.hash = result.new_hash;
      }

      return { success: true };
    } else {
      if (showToast) {
        showNotification(`Failed: ${result.message}`, "error");
      }
      return { success: false, message: result.message };
    }
  } catch (error) {
    if (showToast) {
      showNotification(`Error: ${error.message}`, "error");
    }
    return { success: false, message: error.message };
  }
}

// Show notification toast
function showNotification(message, type = "info") {
  const existing = document.querySelector(".notification-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = `notification-toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("show");
  }, 10);

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Update unsaved change indicators
function updateUnsavedIndicators() {
  document.querySelectorAll(".unsaved-indicator").forEach((indicator) => {
    const pane = indicator.closest(".panel").dataset.pane;
    if (window.DIRTY_PANES.has(Number.parseInt(pane, 10))) {
      indicator.classList.remove("hidden");
    } else {
      indicator.classList.add("hidden");
    }
  });
}

// Update save all button visibility
function updateSaveAllButton() {
  const btn = document.getElementById("saveAllBtn");
  if (window.EDIT_MODE && window.DIRTY_PANES.size > 0) {
    btn.classList.remove("hidden");
  } else {
    btn.classList.add("hidden");
  }
}

// Track content changes
function onContentChange(paneIndex) {
  window.DIRTY_PANES.add(paneIndex);
  updateUnsavedIndicators();
  updateSaveAllButton();

  // Show save button for this pane
  const saveBtn = document.querySelector(`.save-pane-btn[data-pane="${paneIndex}"]`);
  if (saveBtn) saveBtn.classList.remove("hidden");
}

function setupSyncScroll() {
  if (!window.SYNC_SCROLL) return;

  const panes = document.querySelectorAll(".panel-content");
  let isSyncing = false;

  panes.forEach((sourcePane) => {
    sourcePane.addEventListener("scroll", () => {
      if (isSyncing || !window.SYNC_SCROLL) return;

      isSyncing = true;
      requestAnimationFrame(() => {
        const scrollTop = sourcePane.scrollTop;
        const scrollLeft = sourcePane.scrollLeft;

        panes.forEach((targetPane) => {
          if (targetPane !== sourcePane) {
            targetPane.scrollTop = scrollTop;
            targetPane.scrollLeft = scrollLeft;
          }
        });

        isSyncing = false;
      });
    });
  });
}

// Setup keyboard shortcuts
function setupKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
    const cmdKey = isMac ? e.metaKey : e.ctrlKey;

    if (!cmdKey) return;

    // Ctrl/Cmd+S: Save focused pane
    if (e.key === "s" && !e.shiftKey) {
      e.preventDefault();
      if (!window.EDIT_MODE) return;

      const activeElement = document.activeElement;
      if (activeElement?.classList.contains("config-editor")) {
        const paneIndex = Number.parseInt(activeElement.dataset.pane, 10);
        void savePane(paneIndex);
      }
    }

    // Ctrl/Cmd+Shift+S: Save all panes
    if (e.key === "S" || (e.key === "s" && e.shiftKey)) {
      e.preventDefault();
      if (!window.EDIT_MODE || window.DIRTY_PANES.size === 0) return;
      void saveAllPanes();
    }

    // Ctrl/Cmd+E: Toggle edit mode
    if (e.key === "e" || e.key === "E") {
      e.preventDefault();
      toggleEditMode();
    }
  });
}

// Warn about unsaved changes on page unload
function setupBeforeUnload() {
  window.addEventListener("beforeunload", (e) => {
    if (window.DIRTY_PANES.size > 0) {
      e.preventDefault();
      e.returnValue = "";
      return "";
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("textarea.config-editor").forEach((textarea) => {
    const paneIndex = Number.parseInt(textarea.dataset.pane, 10);
    textarea.addEventListener("input", () => onContentChange(paneIndex));
  });
  setupSyncScroll();
  setupKeyboardShortcuts();
  setupBeforeUnload();
  updateSaveAllButton();
});
