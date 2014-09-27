App.MessagesView = Ember.View.extend(App.Scrolling, {
	templateName: 'messages',
	classNames: 'backlog',
	classNameBindings: ['push'],

	push: function() {
		return (this.get('controller.target.content.selectedTab.unread')) ? 'push' : '';
	}.property('controller.target.content.selectedTab.unread').cacheable(),

	animateScrollTo: function (scrollTo) {
		this.$().animate({
			scrollTop: scrollTo
		}, 250);
		// Animate scroll to work around iPhone bug on setting scroll
		// position on touch scrollable elements.
	},

	didInsertElement: function() {
		Ember.run.later(this, function() {
			this.animateScrollTo(this.get('element').scrollHeight);
			this.set('scrollPosition', this.get('element').scrollHeight);
		}, 100);
		// scroll to bottom on render

		this.bindScrolling({debounce: 50, element: this.get('element')});
		// scroll handler

		this.scrolled();
		// immediately run this when the element is inserted

		document.addEvent('keydown', this.documentKeyDown.bind(this));
		// bind keydown event so we can hook onto ESC
	},

	willRemoveElement: function() {
		document.removeEvent('keydown', this.documentKeyDown.bind(this));
		// unbind keydown

		this.unbindScrolling();
	},

	documentKeyDown: function(e) {
		var keyCode = e.keyCode || e.which;
		if (keyCode === 27) {
			this.get('controller.target').markAllAsRead(this.get('controller.target.content.selectedTab._id'));
		}
	},

	resizeSensor: function() {
		if (!this.get('element')) {
			return false;
		}
		// we've not rendered the view yet so just bail

		var parent = this.get('element'),
			height = parent.scrollHeight - parent.clientHeight,
			pos = parent.scrollTop,
			last = parent.querySelectorAll('.inside-backlog div.row:last-of-type'),
			offset = height - pos;
		// get some variables and do some calculations

		if (offset === last.clientHeight || pos === height) {
			Ember.run.later(this, function() {
				if (!this.get('element')) {
					this.animateScrollTo(parent.scrollHeight);
					this.set('scrollPosition', parent.scrollHeight);
				}
			}, 100);
		}
		// we need to reposition the scrollbar!

		Ember.run.later(this, function() {
			this.scrolled();
		}, 100);
	}.observes('controller.filtered.@each'),

	scrolled: function() {
		if (this.$() === undefined) {
			return false;
		}
		// we've not rendered the view yet so just bail
		
		var self = this,
			parent = this.$(),
			tabId = parent.parents('.tab').attr('id').substr(4),
			scrollBottom = parent.height() + parent.scrollTop(),
			scrollTop = scrollBottom - parent.height();
		
		this.controller.send('detectUnread', tabId, scrollTop, scrollBottom);
		// send to controller to do the actual updating

		self.set('scrollPosition', scrollBottom);
		// reset the scroll position
	}.observes('App.isActive')
});