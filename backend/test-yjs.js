const Y = require('yjs');
const { getYDoc } = require('y-websocket/bin/utils');

const doc = getYDoc('test-room');
const ytext = doc.getText('monaco');
ytext.insert(0, "Hello World");
console.log("Server ytext:", ytext.toString());

// Simulate client connecting and getting state vector
const stateVector = Y.encodeStateVector(new Y.Doc());
const update = Y.encodeStateAsUpdate(doc, stateVector);

const clientDoc = new Y.Doc();
Y.applyUpdate(clientDoc, update);
const clientYtext = clientDoc.getText('monaco');
console.log("Client ytext:", clientYtext.toString());
