import * as vscode from 'vscode';

const parseJSON = require('json-to-ast');
const regLineSeperator = /\n|\r\n/;

let eol = '\n';
let tab = '    ';

let statusBarPrettify: vscode.StatusBarItem;

enum CollapseType {
	NoCollapse = 0,
	CollapseObjectWithSpace,
	CollapseArrayWithoutSpace,
}

class VisitorState {
	scope : string;
	indent : number;
	collapse : CollapseType;
	arrayIndentString : string;
	objectIndentString : string;
	arraySplitString : string;
	objectSplitString : string;
	constructor(scope : string, indent : number, collapse : CollapseType) {
		this.scope = scope;
		this.indent = indent;
		this.collapse = collapse;
		this.arrayIndentString = collapse === CollapseType.CollapseArrayWithoutSpace ? '' : tab.repeat(Math.max(0, indent - 1)); // No indent on top level object
		this.objectIndentString = collapse === CollapseType.CollapseObjectWithSpace ? '' : this.arrayIndentString;
		this.arraySplitString = collapse === CollapseType.CollapseArrayWithoutSpace ? '' : eol;
		this.objectSplitString = collapse === CollapseType.CollapseObjectWithSpace ? ' ' : this.arraySplitString;
	}
	nextLevel(collapse? : CollapseType) : VisitorState {
		return new VisitorState(
			this.scope,
			this.indent + 1,
			collapse === undefined ? this.collapse : collapse
		);
	}
	nextScope(scope : string) : VisitorState {
		let fullScope = this.scope + '.' + scope;
		let collapse = getCollapseType(fullScope);
		return new VisitorState(
			fullScope,
			this.indent,
			collapse === undefined ? this.collapse : collapse
		);
	}
}

function getCollapseType(scope : string) : CollapseType | undefined {
	if (scope === 'root.time' || scope === 'root.effect' || scope === 'root.note') return CollapseType.CollapseObjectWithSpace;
	if (scope.endsWith('.beat') || scope.endsWith('.endbeat')) return CollapseType.CollapseArrayWithoutSpace;
	return undefined;
}

function visitor(ast : any, state : VisitorState) : string {
    let data = '';

    switch (ast.type) {
        case 'Object':
            data += '{' + state.objectSplitString;
            if (ast.hasOwnProperty('children')) {
				let items: string[] = [];
                ast.children.forEach((child: any) => {
                    items.push(visitor(child, state.nextLevel()));
                });
                data += items.join(',' + state.objectSplitString) + state.objectSplitString;
            }
            data += state.objectIndentString + '}';
            break;

        case 'Array':
            data += '[' + state.arraySplitString;
            if (ast.hasOwnProperty('children')) {
				let items: string[] = [];
				let nextState = state.nextLevel();
                ast.children.forEach((child: any) => {
					items.push(nextState.arrayIndentString + visitor(child, state.nextLevel()));
                });
                data += items.join(',' + state.arraySplitString) + state.arraySplitString;
            }
            data += state.arrayIndentString + ']';
            break;

        case 'Property':
			data += state.objectIndentString + ast.key.raw + ': ' +
				visitor(ast.value, state.nextScope(ast.key.value));
            break;

        case 'Literal':
            data += ast.raw;
            break;

        default:
            break;
    }

    return data;
}

export function prettify(data : string) : Promise<string> {
    return new Promise((resolve, reject) => {
        let ast = parseJSON(data, { loc: false });
        resolve(visitor(ast, new VisitorState('root', 0, CollapseType.NoCollapse)) + '\n');
    });
}

function commandPrettify() {
	const editor = vscode.window.activeTextEditor;
	if (!editor) return;

	let tabSize = typeof editor.options.tabSize === 'number' ? editor.options.tabSize : 4;

	eol = editor.document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
	tab = editor.options.insertSpaces ? ' '.repeat(tabSize) : '\t';

	const raw = editor.document.getText();

	new Promise<string>((resolve, reject) => {
		let ast = parseJSON(raw, { loc: false });
		resolve(visitor(ast, new VisitorState('root', 0, CollapseType.NoCollapse)) + '\n');
	}).then(content => {
		return editor.edit(builder => {
			const start = new vscode.Position(0, 0);
			const lines = raw.split(regLineSeperator);
			const end = new vscode.Position(lines.length, lines[lines.length - 1].length);
			const allRange = new vscode.Range(start, end);
			builder.replace(allRange, content);
		});
	}).then(success => {
		console.log('prettify mc finished');
	}).catch(reason => {
		console.error(reason);
	});
}

function updateStatusBar(): void {
	if (vscode.window.activeTextEditor?.document.languageId === "malodychart") {
		statusBarPrettify.show();
	} else {
		statusBarPrettify.hide();
	}
}

export function activate({ subscriptions } : vscode.ExtensionContext) {
	subscriptions.push(vscode.commands.registerCommand('malody.prettify', commandPrettify));

	statusBarPrettify = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBarPrettify.text = "$(list-selection) Prettify MC";
	statusBarPrettify.command = 'malody.prettify';
	subscriptions.push(statusBarPrettify);

	subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateStatusBar));

	updateStatusBar();
}

export function deactivate() {}
