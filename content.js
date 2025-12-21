(function() {
  'use strict';

  const UNCHECKED_PATTERN = /^\[\s*\]\s*/;
  const CHECKED_PATTERN = /^\[x\]\s*/i;
  const ANY_TASK_PATTERN = /^\[[\sx]\]\s*/i;

  // svg checkbox icons
  const CHECK_SVG = `<svg width="16" height="16" viewBox="0 0 16 16" style="display:block;">
    <rect x="1" y="1" width="14" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>
    <path d="M 4 8 L 7 11 L 12 5" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

  const UNCHECK_SVG = `<svg width="16" height="16" viewBox="0 0 16 16" style="display:block;">
    <rect x="1" y="1" width="14" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>
  </svg>`;

  // Store auto-save timers and original states per event cell
  const autoSaveTimers = new WeakMap();
  const originalStates = new WeakMap();

  // Shared save logic used by both manual clicks and auto-save
  async function performSave(eventCell, newTitle) {
    const hideStyle = document.createElement('style');
    hideStyle.id = 'proton-task-hide-modal';
    hideStyle.textContent = '.modal-two, [role="dialog"], .eventpopover { opacity: 0 !important; pointer-events: none !important; }';
    document.head.appendChild(hideStyle);

    let refreshTimer = null;

    try {
      await new Promise(resolve => setTimeout(resolve, 400));

      const editButton = document.querySelector('button[data-testid="event-popover:edit"]');
      if (!editButton) return;

      editButton.click();
      await new Promise(resolve => setTimeout(resolve, 500));

      const titleInput = document.querySelector('#event-title-input');
      if (!titleInput) return;

      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeInputValueSetter.call(titleInput, newTitle);

      titleInput.dispatchEvent(new Event('input', { bubbles: true }));
      titleInput.dispatchEvent(new Event('change', { bubbles: true }));

      await new Promise(resolve => setTimeout(resolve, 150));

      const saveButton = document.querySelector('button[data-testid="create-event-modal:save"]');
      if (!saveButton) return;

      saveButton.click();
      await new Promise(resolve => setTimeout(resolve, 800));

    } finally {
      const style = document.getElementById('proton-task-hide-modal');
      if (style) style.remove();
      // Restore opacity instantly (no transition for un-dimming)
      eventCell.style.setProperty('transition', 'none', 'important');
      eventCell.style.setProperty('opacity', '1', 'important');
      // Force reflow to ensure instant change
      void eventCell.offsetHeight;
      eventCell.style.transition = '';
      eventCell.style.opacity = '';
      refreshTimer = setTimeout(() => processAllEvents(), 1500);
    }

    return refreshTimer;
  }

  // Auto-trigger save by simulating a click on the event
  async function triggerAutoSave(eventCell) {
    if (!eventCell.dataset.pendingTitle) return;

    // Temporarily disable checkbox during auto-save
    const checkbox = eventCell.querySelector('.proton-task-checkbox');
    if (checkbox) checkbox.style.pointerEvents = 'none';

    // Determine click target (title span for all-day, eventCell for timed)
    const isAllDay = eventCell.classList.contains('calendar-dayeventcell');
    const titleSpan = eventCell.querySelector('.calendar-dayeventcell-title') ||
                      eventCell.querySelector('.calendar-eventcell-title');
    const clickTarget = isAllDay ? titleSpan : eventCell;

    if (clickTarget) {
      const rect = clickTarget.getBoundingClientRect();
      const x = rect.left + 10;
      const y = rect.top + rect.height / 2;

      ['mousedown', 'mouseup', 'click'].forEach(type => {
        clickTarget.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: x,
          clientY: y,
          button: 0
        }));
      });
    }

    // Re-enable checkbox after short delay
    setTimeout(() => {
      if (checkbox) checkbox.style.pointerEvents = '';
    }, 100);
  }

  function processEventCell(eventCell) {
    // Try both all-day and timed event title selectors
    const titleSpan = eventCell.querySelector('.calendar-dayeventcell-title') || 
                      eventCell.querySelector('.calendar-eventcell-title');
    if (!titleSpan) return;

    const titleText = titleSpan.textContent.trim();
    
    if (!ANY_TASK_PATTERN.test(titleText)) {
      return;
    }

    const isChecked = CHECKED_PATTERN.test(titleText);
    const taskText = titleText.replace(ANY_TASK_PATTERN, '').trim();

    // check if already has checkbox
    let checkbox = eventCell.querySelector('.proton-task-checkbox');
    if (checkbox) {
      // update existing checkbox and title (handles reprocessing after save)
      titleSpan.textContent = taskText;
      checkbox.innerHTML = isChecked ? CHECK_SVG : UNCHECK_SVG;
      checkbox.dataset.checked = isChecked ? 'true' : 'false';
      if (isChecked) {
        titleSpan.style.textDecoration = 'line-through';
        titleSpan.style.opacity = '0.6';
      } else {
        titleSpan.style.textDecoration = 'none';
        titleSpan.style.opacity = '1';
      }
      return;
    }

    eventCell.dataset.taskProcessed = 'true';

    checkbox = document.createElement('span');
    checkbox.className = 'proton-task-checkbox';
    checkbox.innerHTML = isChecked ? CHECK_SVG : UNCHECK_SVG;
    checkbox.dataset.checked = isChecked ? 'true' : 'false';

    // remove the [ ] or [x] from the title
    titleSpan.textContent = taskText;
    if (isChecked) {
      titleSpan.style.textDecoration = 'line-through';
      titleSpan.style.opacity = '0.6';
    }

    const container = titleSpan.parentElement;
    container.insertBefore(checkbox, titleSpan);

    // only checkbox is clickable, prevent event modal from opening
    checkbox.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const currentChecked = checkbox.dataset.checked === 'true';
      const newChecked = !currentChecked;

      // update ui immediately
      checkbox.innerHTML = newChecked ? CHECK_SVG : UNCHECK_SVG;
      checkbox.dataset.checked = newChecked ? 'true' : 'false';

      if (newChecked) {
        titleSpan.style.textDecoration = 'line-through';
        titleSpan.style.opacity = '0.6';
      } else {
        titleSpan.style.textDecoration = 'none';
        titleSpan.style.opacity = '1';
      }

      // Store current state for pending update (use current title text)
      const currentTaskText = titleSpan.textContent.trim();
      const newTitle = newChecked ? `[x] ${currentTaskText}` : `[ ] ${currentTaskText}`;

      // If this is the first click, store the original state
      if (!originalStates.has(eventCell)) {
        const originalTitle = currentChecked ? `[x] ${currentTaskText}` : `[ ] ${currentTaskText}`;
        originalStates.set(eventCell, originalTitle);
      }

      // Check if we've returned to the original state
      const originalTitle = originalStates.get(eventCell);
      if (newTitle === originalTitle) {
        // Back to original state - cancel the save
        const existingTimer = autoSaveTimers.get(eventCell);
        if (existingTimer) {
          clearTimeout(existingTimer);
          autoSaveTimers.delete(eventCell);
        }
        delete eventCell.dataset.pendingTitle;
        originalStates.delete(eventCell);
        eventCell.style.opacity = '';
        eventCell.style.transition = '';
        return;
      }

      eventCell.dataset.pendingTitle = newTitle;

      // Clear any existing timer (debounce logic for rapid toggling)
      const existingTimer = autoSaveTimers.get(eventCell);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      // Add dimming effect while save is pending with transition
      eventCell.style.transition = 'opacity 0.08s ease-out';
      eventCell.style.opacity = '0.8';

      // Set up auto-save timer
      const timer = setTimeout(() => {
        triggerAutoSave(eventCell);
        autoSaveTimers.delete(eventCell);
        originalStates.delete(eventCell);
      }, 250);

      autoSaveTimers.set(eventCell, timer);
    }, true);
  }

  // Intercept clicks to handle auto-save
  function setupInterceptor() {
    document.addEventListener('click', async (e) => {
      const eventCell = e.target.closest('.calendar-dayeventcell') ||
                        e.target.closest('.calendar-eventcell');
      if (!eventCell || !eventCell.dataset.pendingTitle) return;

      const newTitle = eventCell.dataset.pendingTitle;
      delete eventCell.dataset.pendingTitle;

      await performSave(eventCell, newTitle);
    }, true);
  }


  function processAllEvents() {
    // Query both all-day events and timed events
    const allDayEvents = document.querySelectorAll('.calendar-dayeventcell');
    const timedEvents = document.querySelectorAll('.calendar-eventcell');
    
    allDayEvents.forEach(processEventCell);
    timedEvents.forEach(processEventCell);
  }

  function setupObserver() {
    const observer = new MutationObserver((mutations) => {
      let shouldProcess = false;
      
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0 || 
            mutation.type === 'characterData' || 
            mutation.type === 'childList') {
          shouldProcess = true;
          break;
        }
      }
      
      if (shouldProcess) {
        processAllEvents();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    return observer;
  }

  function init() {
    processAllEvents();
    setupObserver();
    setupInterceptor();
    setInterval(processAllEvents, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
