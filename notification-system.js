/**
 * Notification System
 * Manages in-app notifications and alerts
 */

class NotificationSystem {
    constructor() {
        this.notifications = [];
        this.maxNotifications = 5;
    }

    /**
     * Show a notification
     * @param {string} message - The notification message
     * @param {string} type - Type: 'success', 'error', 'warning', 'info'
     * @param {number} duration - Duration in ms (0 = persistent)
     */
    show(message, type = 'info', duration = 5000) {
        const id = Date.now();
        const notification = { id, message, type, duration };
        
        this.notifications.push(notification);
        
        // Keep only recent notifications
        if (this.notifications.length > this.maxNotifications) {
            this.notifications.shift();
        }

        // Auto-remove after duration (if duration > 0)
        if (duration > 0) {
            setTimeout(() => this.remove(id), duration);
        }

        return id;
    }

    /**
     * Remove a notification
     * @param {number} id - Notification ID
     */
    remove(id) {
        this.notifications = this.notifications.filter(n => n.id !== id);
    }

    /**
     * Show success notification
     */
    success(message, duration = 5000) {
        return this.show(message, 'success', duration);
    }

    /**
     * Show error notification
     */
    error(message, duration = 5000) {
        return this.show(message, 'error', duration);
    }

    /**
     * Show warning notification
     */
    warning(message, duration = 5000) {
        return this.show(message, 'warning', duration);
    }

    /**
     * Show info notification
     */
    info(message, duration = 5000) {
        return this.show(message, 'info', duration);
    }

    /**
     * Clear all notifications
     */
    clear() {
        this.notifications = [];
    }
}

// Initialize global notification system
window.notificationSystem = new NotificationSystem();
console.log('✅ Notification System initialized');
