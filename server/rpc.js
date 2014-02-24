/**
 * IRCAnywhere server/rpc.js
 *
 * @title RPCHandler
 * @copyright (c) 2013-2014 http://ircanywhere.com
 * @license GPL v2
 * @author Ricki Hastings
*/

var _ = require('lodash'),
	hooks = require('hooks'),
	helper = require('../lib/helpers').Helpers,
	WebSocket = require('./websocket').WebSocket,
	mongo = require('mongodb');

/**
 * Singleton class to handle the inbound and outbound RPC calls on the websocket lines
 *
 * @class RPCHandler
 * @method RPCHandler
 * @return void
 */
function RPCHandler() {
	var self = this;

	application.ee.on('ready', function() {
		fibrous.run(self.init.bind(self));
	});
}

/**
 * Called when the application is ready, sets up an observer on our collections
 * so we can figure out whether we need to propogate them to clients.
 *
 * @method init
 * @return void
 */
RPCHandler.prototype.init = function() {
	var self = this;

	application.ee.on(['users', 'update'], self.handleUsersUpdate);
	application.ee.on(['networks', '*'], self.handleNetworksAll);
	application.ee.on(['tabs', '*'], self.handleTabsAll);
	application.ee.on(['events', 'insert'], self.handleEventsInsert);
	application.ee.on(['commands', 'insert'], self.handleCommandsInsert);
	application.ee.on(['channelUsers', '*'], self.handleChannelUsersAll);
	// handle changes to our collections individually this time
}

/**
 * Handles any update changes to the users collection and sends changes to clients
 *
 * @method handleUsersUpdate
 * @param {Object} doc A valid MongoDB document with an _id
 * @return void
 */
RPCHandler.prototype.handleUsersUpdate = function(doc) {
	var socket = Users[doc._id];

	delete doc.lastSeen;
	doc = _.omit(doc, 'salt', 'password', 'tokens');
	// alter the document

	if (socket) {
		socket.send('updateUser', doc);
	}
}

/**
 * Handles any all changes to the network collection
 *
 * @method handleNetworksAll
 * @param {Object} doc A valid MongoDB document with an _id
 * @return void
 */
RPCHandler.prototype.handleNetworksAll = function(doc) {
	var eventName = this.event[1],
		socket = Users[doc.internal.userId];

	if (socket) {
		if (eventName === 'insert') {
			socket.send('addNetwork', doc);
		} else if (eventName === 'update') {
			socket.send('updateNetwork', doc);
		} else if (eventName === 'delete') {
			socket.send('removeNetwork', doc);
		}
	}
}

/**
 * Handles all changes to the tabs collections
 *
 * @method handleTabsAll
 * @param {Object} doc A valid MongoDB document with an _id
 * @return void
 */
RPCHandler.prototype.handleTabsAll = function(doc) {
	var eventName = this.event[1],
		socket = false;

	if (eventName === 'delete') {
		_.each(Clients, function(value, key) {
			var tab = _.find(value.internal.tabs, {'_id': doc});
			if (tab) {
				socket = Users[value.internal.userId];
				delete Clients[key].internal.tabs[tab.target];
			}
		});
		// find out which user this tab belongs to?
	} else {
		socket = Users[doc.user];
	}

	if (socket) {
		if (eventName === 'insert') {
			socket.send('addTab', doc);
		} else if (eventName === 'update') {
			socket.send('updateTab', doc);
		} else if (eventName === 'delete') {
			socket.send('removeTab', doc);
		}
	}
}

/**
 * Handles any inserts to the events collection
 *
 * @method handleEventsInsert
 * @param {Object} doc A valid MongoDB document with an _id
 * @return void
 */
RPCHandler.prototype.handleEventsInsert = function(doc) {
	var socket = Users[doc.user];

	doc = _.omit(doc, 'user');
	// alter the document

	if (socket) {
		socket.send('newEvent', doc);
	}
}

/**
 * Handles any inserts to the commands collection
 *
 * @method handleCommandsInsert
 * @param {Object} doc A valid MongoDB document with an _id
 * @return void
 */
RPCHandler.prototype.handleCommandsInsert = function(doc) {
	var socket = Users[doc.user];

	if (socket && !doc.backlog) {
		socket.send('newBacklog', doc);
	}
}


/**
 * Handles any changes on the channelUsers collection
 *
 * @method handleChannelUsersAll
 * @param {Object} doc A valid MongoDB document with an _id
 * @return void
 */
RPCHandler.prototype.handleChannelUsersAll = function(doc) {
	var eventName = this.event[1],
		socket = false;

	_.each(Clients, function(value, key) {
		var tab = _.find(value.internal.tabs, {'networkName': doc.network, 'target': doc.channel});
		if (tab) {
			socket = Users[tab.user];
		}
	});
	// find the tab that this change is for

	doc = _.omit(doc, 'username', 'hostname', '_burst');
	// alter the document

	if (socket) {
		if (eventName === 'insert') {
			socket.send('newChannelUser', doc);
		} else if (eventName === 'update') {
			socket.send('updateChannelUser', doc);
		} else if (eventName === 'delete') {
			socket.send('deleteChannelUser', doc);
		}
	}
}

/**
 * Handles a new websocket opening and attaches the RPC events
 *
 * @method onSocketOpen
 * @param {Object} socket A valid sock.js socket
 * @return void
 */
RPCHandler.prototype.onSocketOpen = function(socket) {
	// so here we handle incoming websocket connections
	// and then wrap them in our own websocket rpc which handles
	// event binding and such, doing this allows us to quickly
	// switch websocket engines if we ever need to and gives us a standard
	// api which is extendable by people writing modules

	var self = this,
		webSocket = new WebSocket(socket);
	// create the websocket and assign it to Sockets[id]
	// websocket constructor handles event binding etc

	webSocket.on('authenticate', function(data) {
		fibrous.run(function() {
			self.handleAuth(webSocket, data);
		});
	});

	webSocket.on('sendCommand', function(data) {
		fibrous.run(function() {
			self.handleCommand(webSocket, data, false);
		});
	});

	webSocket.on('execCommand', function(data) {
		fibrous.run(function() {
			self.handleCommand(webSocket, data, true);
		});
	});

	webSocket.on('readEvents', function(data) {
		fibrous.run(function() {
			self.handleReadEvents(webSocket, data);
		});
	});

	webSocket.on('selectTab', function(data) {
		fibrous.run(function() {
			self.handleSelectTab(webSocket, data);
		});
	});

	webSocket.on('updateTab', function(data) {
		fibrous.run(function() {
			self.handleUpdateTab(webSocket, data);
		});
	});

	webSocket.on('insertTab', function(data) {
		fibrous.run(function() {
			self.handleInsertTab(webSocket, data);
		});
	});

	webSocket.on('getEvents', function(data) {
		fibrous.run(function() {
			self.handleGetEvents(webSocket, data);
		});
	});

	Sockets[socket.id] = webSocket;
}

/**
 * Handles the authentication command sent to us from websocket clients
 * Authenticates us against login tokens in the user record, disconnects
 * if expired or incorrect.
 *
 * @method handleAuth
 * @param {Object} socket A valid sock.js socket
 * @param {Object} data A valid data object from sock.js
 * @return void
 */
RPCHandler.prototype.handleAuth = function(socket, data) {
	var user = userManager.isAuthenticated(data);
	
	if (!user) {
		socket.send('authenticate', false, true);
	} else {
		socket._user = user;
		Users[user._id] = socket;

		socket.send('authenticate', true, false);

		this.handleConnect(socket);
		// handle sending out data on connect
	}
}

/**
 * Handles new websocket clients, this is only done after
 * they have been authenticated and it's been accepted.
 * 
 * @method handleConnect
 * @param {Object} socket A valid sock.js socket
 * @return void
 */
RPCHandler.prototype.handleConnect = function(socket) {
	var user = socket._user,
		networks = application.Networks.sync.find({'internal.userId': user._id}).sync.toArray(),
		tabs = application.Tabs.sync.find({user: user._id}).sync.toArray(),
		netIds = {},
		items = [],
		usersQuery = {$or: []},
		commandsQuery = {$or: []};

	var tabUrls = _.map(tabs, 'url');
	if (tabUrls.indexOf(user.selectedTab) === -1 && tabs.length > 0) {
		user.selectedTab = tabs[0].url;
	}
	// determine whether we have a selected tab or not?

	networks.forEach(function(network) {
		netIds[network._id] = {
			name: network.name,
			nick: network.nick.toLowerCase()
		};
	});

	tabs.forEach(function(tab, index) {
		usersQuery.$or.push({network: netIds[tab.network].name, channel: tab.target});
		commandsQuery.$or.push({network: tab.network, target: tab.target});
		// construct some queries

		if (tab.type === 'query') {
			var query = {network: netIds[tab.network].name, user: user._id, $or: [{target: tab.target}, {'message.nickname': new RegExp(tab.target, 'i'), target: netIds[tab.network].nick}]};
		} else if (tab.type === 'network') {
			var query = {network: netIds[tab.network].name, target: '*', user: user._id}
		} else {
			var query = {network: netIds[tab.network].name, target: tab.target, user: user._id}
		}

		var eventResults = application.Events.sync.find(query, ['_id', 'extra', 'message', 'network', 'read', 'target', 'type']).sort({'message.time': -1}).limit(50).sync.toArray(),
			unreadItems = application.Events.sync.find(_.extend({read: false}, query)).sync.count(),
			unreadHighlights = application.Events.sync.find(_.extend({'extra.highlight': true, read: false}, query)).sync.count();
		// get some information about the unread items/highlights

		tab.unread = unreadItems;
		tab.highlights = unreadHighlights;
		items = _.union(items, eventResults);
		// combine the results
	});
	// loop tabs

	if (tabs.length === 0) {
		var users = [],
			commands = [];
	} else {
		var users = application.ChannelUsers.sync.find(usersQuery, ['nickname', 'network', 'channel', 'sort', 'prefix', '_id']).sync.toArray(),
			commands = application.Commands.sync.find(_.extend({user: user._id, backlog: true}, commandsQuery)).sync.toArray();
	}
	// get channel users and commands

	socket.sendBurst({
		users: [_.omit(user, 'salt', 'password', 'tokens')],
		networks: networks,
		tabs: tabs,
		channelUsers: users,
		events: items,
		commands: commands,
		burstend: true
	});
	// send the info

	application.Users.update({_id: user._id}, {$set: {lastSeen: new Date(), selectedTab: user.selectedTab}}, {safe: false});
	// update last seen time
}

/**
 * Handles the exec command RPC call. Which should be used to execute /commands
 * from the clientside without inserting them into the backlog.
 *
 * @method handleCommand
 * @param {Object} socket A valid sock.js socket
 * @param {Object} data A valid data object from sock.js
 * @param {Boolean} exec Whether to exec the command or backlog it
 * @return void
 */
RPCHandler.prototype.handleCommand = function(socket, data, exec) {
	var exec = exec || false,
		allow = false,
		allowed = ['command', 'network', 'target'],
		command = (exec) ? 'execCommand' : 'sendCommand',
		user = socket._user,
		data = data.object;

	if (!data) {
		return socket.send('error', {command: command, error: 'invalid format, see API docs'});
	}

	_.forOwn(data, function(value, item) {
		if ((item === 'command' || item === 'network' || item === 'target') && typeof value === 'string') {
			allow = true;
		}

		if (_.indexOf(allowed, item) === -1) {
			allow = false;
		}
		// invalid key
	});
	
	if (!allow) {
		return socket.send('error', {command: command, error: 'invalid document properties, see API docs'});
	}

	var find = application.Tabs.sync.findOne({networkName: data.network, user: user._id, target: data.target});
	// try and find a valid tab

	if (!find) {
		return socket.send('error', {command: command, error: 'not authorised to call this command'});
	}

	data.user = user._id;
	data.timestamp = +new Date();
	data.network = find.network;
	data.backlog = !exec;
	// bail if we can't find the tab, if we can re-set the network value

	application.Commands.insert(data, {safe: false});
	// insert
}

/**
 * Handles the command which marks events as read. It takes a MongoDB query and updates
 * them with that query.
 *
 * @method handleReadEvents
 * @param {Object} socket A valid sock.js socket
 * @param {Object} data A valid data object from sock.js
 * @return void
 */
RPCHandler.prototype.handleReadEvents = function(socket, data) {
	var user = socket._user,
		query = data.query,
		object = data.object;

	if (!query || !object) {
		return socket.send('error', {command: 'readEvents', error: 'invalid format, see API docs'});
	}

	if (!_.difference(_.keys(object), ['read']).length === 0 && typeof object.read === 'boolean') {
		return socket.send('error', {command: 'readEvents', error: 'invalid document properties, see API docs'});
	}

	if (query._id) {
		query._id = new mongo.ObjectID(query._id);
	}
	// update it to a proper mongo id

	if ('$in' in query) {
		for (var i in query.$in) {
			query.$in = new mongo.ObjectID(query.$in);
		}

		query = {_id: query};
	}

	if ('$or' in query) {
		for (var i in query.$or) {
			var subQuery = query.$or[i];

			if ('_id' in subQuery) {
				subQuery._id = new mongo.ObjectID(subQuery._id);
				query.$or[i] = subQuery;
			}
		}
	}
	// convert _id to proper mongo IDs
	
	application.Events.update(query, {$set: object}, {multi: true, safe: false});
}

/**
 * Handles the selectTab command which is used to change the currently active tab
 * for that user.
 *
 * @method handleSelectTab
 * @param {Object} socket A valid sock.js socket
 * @param {Object} data A valid data object from sock.js
 * @return void
 */
RPCHandler.prototype.handleSelectTab = function(socket, data) {
	var user = socket._user,
		exists = false;
		url = data.object;

	if (!url) {
		return socket.send('error', {command: 'selectTab', error: 'invalid format, see API docs'});
	}

	_.each(Clients, function(value, key) {
		if (value.internal.userId.toString() !== user._id.toString()) {
			return;
		}

		exists = _.find(value.internal.tabs, {'url': url});
	});

	if (!exists) {
		return socket.send('error', {command: 'selectTab', error: 'invalid document properties, see API docs'});
	}

	application.Users.update({_id: user._id}, {$set: {selectedTab: url}}, {safe: false});
}

/**
 * Handles the update tab command, we're allowed to change client side only settings here
 * ``hiddenUsers`` and ``hiddenEvents`` only at the moment.
 *
 * @method handleUpdateTab
 * @param {Object} socket A valid sock.js socket
 * @param {Object} data A valid data object from sock.js
 * @return void
 */
RPCHandler.prototype.handleUpdateTab = function(socket, data) {
	var user = socket._user,
		allow = false,
		allowed = ['hiddenUsers', 'hiddenEvents'],
		tab = data.query,
		data = data.object;

	if (!tab || !data) {
		return socket.send('error', {command: 'updateTab', error: 'invalid format, see API docs'});
	}

	_.forOwn(data, function(value, item) {
		if ((item === 'hiddenUsers' || item == 'hiddenEvents') && typeof value === 'boolean') {
			allow = true;
		}
		// check the values?

		if (_.indexOf(allowed, item) === -1) {
			allow = false;
		}
		// invalid key
	});

	if (!allow) {
		return socket.send('error', {command: 'updateTab', error: 'invalid document properties, see API docs'});
	}

	tab = new mongo.ObjectID(tab);
	// update it to a proper mongo id

	application.Tabs.update({_id: tab, user: user._id}, {$set: data}, {safe: false});
	// update
}

/**
 * Allows users to create new tabs on the fly from the client side. Restricted to ``channel`` and ``query`` tabs.
 *
 * @method handleInsertTab
 * @param {Object} socket A valid sock.js socket
 * @param {Object} data A valid data object from sock.js
 * @return void
 */
RPCHandler.prototype.handleInsertTab = function(socket, data) {
	var user = socket._user,
		allow = false,
		allowed = ['target', 'network', 'selected'],
		data = data.object;

	if (!data) {
		return socket.send('error', {command: 'insertTab', error: 'invalid format, see API docs'});
	}

	_.forOwn(data, function(value, item) {
		if ((item === 'target' || item === 'network') && typeof value === 'string') {
			allow = true;
		}

		if (item === 'selected' && typeof value === 'boolean') {
			allow = true;
		}
		// check the values?

		if (_.indexOf(allowed, item) === -1) {
			allow = false;
		}
		// invalid key
	});

	if (!allow) {
		return socket.send('error', {command: 'insertTab', error: 'invalid document properties, see API docs'});
	}

	var nid = new mongo.ObjectID(data.network),
		ircClient = Clients[nid];

	if (ircClient && ircClient.internal.userId.toString() === user._id.toString()) {
		var type = (helper.isChannel(ircClient, data.target)) ? 'channel' : 'query';
		networkManager.addTab(ircClient, data.target, type, data.selected);
	}
	// we're allowed to continue, use network manager to add the tab
}

/**
 * Handles queries to the events collection
 *
 * @method handleGetEvents
 * @param {Object} socket A valid sock.js socket
 * @param {Object} data A valid data object from sock.js
 * @return void
 */
RPCHandler.prototype.handleGetEvents = function(socket, data) {
	var user = socket._user,
		query = data.query,
		limit = data.object || 50;

	if (!query) {
		return socket.send('error', {command: 'getEvents', error: 'invalid format, see API docs'});
	}

	if (limit > 50) {
		limit = 50;
	}
	// reset back to 50

	if (query._id) {
		for (var op in query._id) {
			var _id = query._id[op];
			
			if (_id) {
				query._id[op] = new mongo.ObjectID(_id);
			}
		}
	}
	// convert _id to proper mongo IDs

	var response = application.Events.sync.find(_.extend({user: user._id}, data.query), ['_id', 'extra', 'message', 'network', 'read', 'target', 'type']).sort({'message.time': -1}).limit(limit).sync.toArray();
	// perform the query 

	socket.send('events', response);
	// get the data
}

exports.RPCHandler = _.extend(RPCHandler, hooks);