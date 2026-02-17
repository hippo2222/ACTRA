/**
 * Universal Undo/Redo Manager
 * Manages state history for any editor
 */
class UndoManager {
    constructor(maxHistory = 50) {
        this.history = [];
        this.currentIndex = -1;
        this.maxHistory = maxHistory;
    }

    /**
     * Save current state to history
     * @param {Object} state - Deep copy of editor state
     */
    pushState(state) {
        // Remove all "future" states after current index
        this.history = this.history.slice(0, this.currentIndex + 1);

        // Add new state (deep copy to prevent mutations)
        this.history.push(JSON.parse(JSON.stringify(state)));
        this.currentIndex++;

        // Limit history size
        if (this.history.length > this.maxHistory) {
            this.history.shift();
            this.currentIndex--;
        }
    }

    /**
     * Undo last action
     * @returns {Object|null} Previous state or null
     */
    undo() {
        if (this.canUndo()) {
            this.currentIndex--;
            return JSON.parse(JSON.stringify(this.history[this.currentIndex]));
        }
        return null;
    }

    /**
     * Redo undone action
     * @returns {Object|null} Next state or null
     */
    redo() {
        if (this.canRedo()) {
            this.currentIndex++;
            return JSON.parse(JSON.stringify(this.history[this.currentIndex]));
        }
        return null;
    }

    canUndo() {
        return this.currentIndex > 0;
    }

    canRedo() {
        return this.currentIndex < this.history.length - 1;
    }

    clear() {
        this.history = [];
        this.currentIndex = -1;
    }

    getHistorySize() {
        return this.history.length;
    }
}
