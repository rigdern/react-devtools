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

function stringifyProps(styles, props) {
  var result = '';
  Object.keys(props).forEach(function (key) {
    var value = props[key];
    if (key !== 'style' &&
        key !== 'children' &&
        value !== undefined && value !== null &&
        (typeof value !== 'object' || value[consts.type] !== 'function')) {
      var stringifiedValue = typeof value === 'string' ?
        JSON.stringify(value) :
        '{' + JSON.stringify(value) + '}';
      result += ' ' + key + '=' + stringifiedValue;
    }
  });
  if (styles) {
    result += ` style={${JSON.stringify(styles)}}`;
  }

  return result;
}

function getNativeStyles(bridge, store, rootId, done) {
  var outstanding = 1;
  var decrementOutstanding = () => {
    outstanding--;
    if (outstanding === 0) {
      done(result);
    }
  };

  var result = {};

  var rec = function (id) {
    var node = store.get(id);
    var isNative = node.get('nodeType') === 'Native';
    var children = node.get('children');

    if (isNative) {
      if (true) {
        outstanding++;
        bridge.call('rn-style:get', id, resolvedStyle => {
          result[id] = resolvedStyle;
          decrementOutstanding();
        });
      } else {
        result[id] = node.get('props')['style'];
      }
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

function stringifyNativeTree(styles, store, rootId) {
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
      stringifyProps(styles[id], node.get('props')) :
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
        getNativeStyles(gBridge, store, id, (styles) => {
          copyToClipboard(stringifyNativeTree(styles, store, id));
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
