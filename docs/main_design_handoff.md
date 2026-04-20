# Main Design Handoff

This document describes the design surface of the internal ACTRA main page and can be handed to a designer as a compact package.

## Scope

This handoff covers only the authenticated internal main page:

- route: `/ui/main`
- template: `frontend/MainScreen/Main.html`
- runtime behavior: `frontend/assets/MainLogic.js`

It does not cover:

- welcome/login/onboarding
- settings page
- editor screens
- catalog/complex/session screens

## Core Files

These files define the look and behavior of the main page.

### Main screen

- `frontend/MainScreen/Main.html`
  - page structure
  - most of the page-specific CSS
  - top bar buttons
  - hero cards
  - widget layout
  - all main-page modal markup

- `frontend/assets/MainLogic.js`
  - loads current user
  - fills dashboard widgets
  - controls state switches
  - opens/closes modals
  - feedback form behavior
  - updates banner behavior
  - quick access rendering

### Shared UI dependencies

- `frontend/assets/SharedProfileModal.js`
  - upper-right account/profile menu

- `frontend/assets/lightB-variables.css`
  - color tokens and theme variables used by the main page

- `frontend/assets/lightB-components.css`
  - shared component styling

- `frontend/assets/tailwind.css`
  - utility classes used across markup

- `frontend/assets/fonts.css`
  - typography assets

- `frontend/assets/ThemeManager.js`
  - theme application

- `frontend/assets/ThemeSwitcherUI.js`
  - theme switching hooks

- `frontend/assets/NotificationUI.js`
  - toasts and confirmation UI

- `frontend/assets/ConnectionMonitor.js`
  - connectivity-driven UI behavior

## Main Page Areas

For design work, the page is best treated as these blocks:

1. Top bar
   - user avatar/name
   - `Обновления`
   - `Обратная связь`

2. Update notice strip
   - appears only when update info is available

3. Primary hero cards
   - training entry card
   - theory center card

4. Main widgets
   - microcards
   - quick access
   - calendar
   - statistics

5. Overlays/modals
   - profile management
   - edit profile
   - password prompt
   - feedback
   - legal document
   - consent gate

## Important State Inventory

Design should be reviewed not only in the default view, but across states. Below is the minimum state set worth showing.

### A. Base page states

1. Main page, default loaded state
2. Main page with long user name in header
3. Main page on smaller laptop width
4. Main page on mobile width

### B. Top bar states

1. Default top bar
2. `Обновления` available as regular button
3. update notice visible
4. profile menu open

### C. Microcards widget states

1. loading
2. empty
3. disabled / placeholder
4. content loaded with due cards

### D. Quick access states

1. empty state
2. populated with several cards
3. populated with long titles/descriptions
4. paused session card
5. failed loading / retry state

### E. Calendar widget states

1. loading
2. empty
3. content loaded with streak and daily mix

### F. Statistics widget states

1. loading / skeleton
2. loaded with normal values
3. error state with retry
4. different period tabs selected

### G. Modal states

1. feedback modal, empty form
2. feedback modal, validation/error state
3. feedback modal, offline/internet warning state
4. profile management modal
5. edit profile modal
6. password prompt modal
7. legal document modal
8. consent gate modal

## State-to-Code Map

This is useful if the designer asks where a specific state comes from.

### Main HTML state containers

- update notice: `#appUpdateNotice`
- microcards:
  - `#microcardsLoadingState`
  - `#microcardsEmptyState`
  - `#microcardsDisabledState`
  - `#microcardsContentState`
- quick access:
  - `#quick-access-list`
  - `#quick-access-empty`
- calendar:
  - `#calendarLoadingState`
  - `#calendarEmptyState`
  - `#calendarContentState`
- statistics:
  - `#statsContent`
  - `#statsSkeleton`

### Main JS entry points

- initialization: `initialize()`
- current user load: `loadCurrentUser()`
- updates: `checkForAppUpdates()`
- feedback:
  - `openFeedbackModal()`
  - `closeFeedbackModal()`
  - `submitFeedback()`
- statistics: `loadStatistics()`
- calendar: `loadCalendarWidget()`
- quick access: `loadQuickAccess()`
- legal docs:
  - `openMainLegalDocument()`
  - `closeMainLegalDocument()`
- consent:
  - `openMainConsentGate()`
  - `submitMainConsentGate()`

## What To Send To The Designer

Minimum package:

1. This document
2. `frontend/MainScreen/Main.html`
3. `frontend/assets/MainLogic.js`
4. `frontend/assets/SharedProfileModal.js`
5. `frontend/assets/lightB-variables.css`
6. `frontend/assets/lightB-components.css`
7. screenshots of the states listed above

If the designer is not expected to read code, send:

1. screenshots
2. this document
3. a short note saying which parts may change freely and which should stay structurally stable

## How To Provide "States"

The easiest way is not to explain them abstractly, but to send screenshot boards.

### Recommended simple format

Create a folder like:

- `docs/design/main-states/`

And place screenshots with names like:

- `01-main-default.png`
- `02-main-update-banner.png`
- `03-main-profile-menu.png`
- `04-main-microcards-empty.png`
- `05-main-microcards-loaded.png`
- `06-main-quick-access-empty.png`
- `07-main-quick-access-loaded.png`
- `08-main-calendar-empty.png`
- `09-main-calendar-loaded.png`
- `10-main-statistics-error.png`
- `11-main-feedback-modal-default.png`
- `12-main-feedback-modal-error.png`
- `13-main-consent-gate.png`

This is already enough for most design reviews.

### If you do not know which states are worth capturing

Use this short checklist:

- one clean default screen
- one screen with every major widget populated
- one screen with empties
- one screen with errors/warnings
- one screen with overlays/modals
- one mobile screenshot

## Practical Capture Plan

If you want to prepare designer material manually, capture in this order:

1. default main page
2. profile menu open
3. update banner visible
4. feedback modal open
5. microcards loaded
6. quick access loaded
7. quick access empty
8. calendar loaded
9. calendar empty
10. statistics loaded
11. statistics error
12. consent modal
13. mobile width view

## Notes For Future Automation

If needed, this can later be automated with Playwright so the project can generate a stable design handoff bundle on demand.

A useful future deliverable would be:

- `scripts/capture_main_design_states.js`

That script could:

1. start the app in test mode
2. seed predictable data
3. open `/ui/main`
4. force specific UI states
5. save screenshots into `docs/design/main-states/`

That would make future design reviews much easier and repeatable.
