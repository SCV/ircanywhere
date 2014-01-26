App = Ember.Application.create({
	defaultTitle: 'IRCAnywhere',
	timeout: null,
	timein: null,
	
	Parser: Ember.Parser.create(),

	Socket: Ember.Socket.extend({
		controllers: ['index', 'login', 'titlebar', 'network', 'messages', 'input', 'sidebar']
    })
});

App.Router.reopen({
	location: 'history'
});