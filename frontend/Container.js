/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @flow
 */
'use strict';

var assign = require('object-assign');
var ContextMenu = require('./ContextMenu');
var PropState = require('./PropState');
var React = require('react');
var SearchPane = require('./SearchPane');
var SplitPane = require('./SplitPane');
var TabbedPane = require('./TabbedPane');

var consts = require('../agent/consts');

import type MenuItem from './ContextMenu';

var gBridge: any;

var _indent = '  ';
function indent(depth, s) {
  for (var i = 0; i < depth; i++) {
    s = _indent + s;
  }
  return s;
}

function stringifyProps(props) {
  var result = '';
  Object.keys(props).forEach(function (key) {
    var value = props[key];
    var stringifiedValue = typeof value === 'string' ?
      JSON.stringify(value) :
      '{' + JSON.stringify(value) + '}';
      result += ' ' + key + '=' + stringifiedValue;
  });

  return result;
}

function getNativeProps(bridge, store, rootId, done) {
  var outstanding = 1;
  var decrementOutstanding = () => {
    outstanding--;
    console.log('outstanding: ' + outstanding);
    if (outstanding === 0) {
      done(result);
    }
  };

  var result = {};

  const resolveCollectionItems = (outProps, id, path, key, inColl) => {
    var collPath = path.concat([key]);
    var outColl = Array.isArray(inColl) ? inColl.slice(0) : assign({}, inColl);
    outProps[key] = outColl;

    if (Array.isArray(inColl)) {
      inColl.forEach((itemValue, itemKey) => {
        resolveProp(outColl, id, collPath, itemKey, itemValue);
      });
    } else {
      Object.keys(inColl).forEach((itemKey) => {
        resolveProp(outColl, id, collPath, itemKey, inColl[itemKey]);
      });
    }
  }

  const resolveProp = (outProps, id, path, key, value) => {
    const otype = typeof value;
    if (otype === 'number' || otype === 'string' || value === null || value === undefined || otype === 'boolean' ||
        value[consts.type] === 'function') {
      return;
    }

    if (value[consts.inspected] === false) {
      if (Array.isArray(value)) {
        throw new Error('Must inspect array');
      }
      outstanding++;
      bridge.inspect(id, path.concat([key]), (resolvedValue) => {
        const finalValue = assign({}, value, resolvedValue);
        outProps[key] = finalValue;
        resolveCollectionItems(outProps, id, path, key, finalValue);
        decrementOutstanding();
      });
    } else {
      resolveCollectionItems(outProps, id, path, key, value);
    }
  };

  var rec = function (id) {
    var node = store.get(id);
    var isNative = node.get('nodeType') === 'Native';
    var children = node.get('children');
    var inProps = node.get('props');
    var outProps = {};
    result[id] = outProps;

    if (isNative) {
      // Resolve style
      outstanding++;
      bridge.call('rn-style:get', id, resolvedStyle => {
        outProps.style = resolvedStyle;
        decrementOutstanding();
      });

      // Resolve props
      Object.keys(inProps).forEach((key) => {
        if (key === 'style' || key === 'children') {
          return;
        }

        resolveProp(outProps, id, ['props'], key, inProps[key]);
      });
    }

    if (children != null && Array.isArray(children)) {
      for (var i = 0; i < children.length; i++) {
        rec(children[i]);
      }
    }
  };

  rec(rootId);
  decrementOutstanding();
}

function stringifyText(text) {
  return `<RCTRawText text=${JSON.stringify(text)} />`;
}

function stringifyNativeTree(propsDb, store, rootId) {
  var nativeComponents = { RCTRawText: true };
  var result = '';
  var rec = function (id, depth) {
    var node = store.get(id);
    var name = node.get('name');
    var isText = node.get('nodeType') === 'Text';
    var isNative = node.get('nodeType') === 'Native';
    var children = node.get('children');

    if (isNative) {
      nativeComponents[name] = true;
    }

    var stringifiedProps = isNative ?
      stringifyProps(propsDb[id]) :
      null;

    if (isText) {
      result += indent(depth, stringifyText(node.get('text')) + '\n');
    } else if (children != null) {
      if (isNative) {
        result += indent(depth, '<' + name + stringifiedProps + '>\n');
      }

      if (Array.isArray(children)) {
        var childDepth = isNative ? (depth + 1) : depth;
        for (var i = 0; i < children.length; i++) {
          rec(children[i], childDepth);
        }
      } else if (typeof children === 'string') {
        result += indent(depth + 1, stringifyText(children) + '\n');
      }

      if (isNative) {
        result += indent(depth, '</' + name + '>\n');
      }
    } else if (isNative) {
      result += indent(depth, '<' + name + stringifiedProps + ' />\n');
    }
  };

  rec(rootId, 0);
  const requires = ['const requireNativeComponent = require(\'requireNativeComponent\');'].concat(Object.keys(nativeComponents).sort().map((c) => {
    return `const ${c} = requireNativeComponent('${c}', null);`;
  }));
  return requires.join('\n') + '\n\n' + result;
}

function copyToClipboard(text) {
  var el = document.createElement('pre');
  el.innerText = text;
  document.body.appendChild(el);

  var range = document.createRange();
  range.selectNode(el);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  document.execCommand('copy');

  document.body.removeChild(el);
}

class Container extends React.Component {
  props: {
    bridge: any;
    reload: () => void,
    extraPanes: Array<(node: Object) => React$Element>,
    extraTabs: ?{[key: string]: () => React$Element},
    menuItems: {
      tree?: (id: string, node: Object, store: Object) => ?Array<MenuItem>,
      attr?: (
        id: string,
        node: Object,
        val: any,
        path: Array<string>,
        name: string,
        store: Object
      ) => ?Array<MenuItem>,
    },
    extraTabs: {[key: string]: () => React$Element},
  };
  componentWillMount() {
    gBridge = this.props.bridge;
  }

  render() {
    var tabs = {
      Elements: () => (
        <SplitPane
          initialWidth={300}
          left={() => <SearchPane reload={this.props.reload} />}
          right={() => <PropState extraPanes={this.props.extraPanes} />}
        />
      ),
      ...this.props.extraTabs,
    };
    return (
      <div style={styles.container}>
        <TabbedPane tabs={tabs} />
        <ContextMenu itemSources={[DEFAULT_MENU_ITEMS, this.props.menuItems]} />
      </div>
    );
  }
}

var DEFAULT_MENU_ITEMS = {
  tree: (id, node, store) => {
    var items = [];
    if (node.get('name')) {
      items.push({
        key: 'showNodesOfType',
        title: 'Show all ' + node.get('name'),
        action: () => store.changeSearch(node.get('name')),
      });
    }
    if (store.capabilities.scroll) {
      items.push({
        key: 'scrollToNode',
        title: 'Scroll to Node',
        action: () => store.scrollToNode(id),
      });
    }
    items.push({
      key: 'copyNativeTree',
      title: 'Copy Native Tree',
      action: () => {
        // TODO: Figure out the right way to get bridge in here instead of using a global.
        getNativeProps(gBridge, store, id, (propsDb) => {
          console.log('stringify & copy');
          copyToClipboard(stringifyNativeTree(propsDb, store, id));
          console.log('copy complete');
        });
      }
    });
    return items;
  },
  attr: (id, node, val, path, name, store) => {
    var items = [{
      title: 'Store as global variable',
      action: () => store.makeGlobal(id, path),
    }];
    return items;
  },
};

var styles = {
  container: {
    flex: 1,
    display: 'flex',
    minWidth: 0,
    backgroundColor: '#fff',
  },
};

module.exports = Container;
