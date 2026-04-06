'use client';

import { useEffect, useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';

export interface EditorActions {
  getSelectedText: () => string;
  replaceSelection: (nextText: string) => void;
}

interface EditorPaneProps {
  value: string;
  onChange: (value: string) => void;
  onSelectionChange?: (selection: string) => void;
  registerActions?: (actions: EditorActions | null) => void;
}

const extensions = [
  markdown({ base: markdownLanguage, codeLanguages: languages }),
  EditorView.lineWrapping,
];

// Main component export: this is the entry point rendered by parent routes/components.
export default function EditorPane({ value, onChange, onSelectionChange, registerActions }: EditorPaneProps) {
  const editorRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!registerActions) return;
    registerActions({
      getSelectedText: () => {
        const view = editorRef.current;
        if (!view) return '';
        const { from, to } = view.state.selection.main;
        return view.state.doc.sliceString(from, to);
      },
      replaceSelection: (nextText: string) => {
        const view = editorRef.current;
        if (!view) return;
        const { from, to } = view.state.selection.main;
        view.dispatch({
          changes: { from, to, insert: nextText },
          selection: { anchor: from + nextText.length },
        });
      },
    });

    return () => registerActions(null);
  }, [registerActions]);

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <CodeMirror
        value={value}
        onChange={onChange}
        onCreateEditor={(view) => {
          editorRef.current = view;
        }}
        onUpdate={(update) => {
          if (!onSelectionChange || !update.selectionSet) return;
          const { from, to } = update.state.selection.main;
          onSelectionChange(update.state.doc.sliceString(from, to));
        }}
        extensions={extensions}
        theme={oneDark}
        height="100%"
        className="flex-1 overflow-hidden text-sm"
        style={{ height: '100%' }}
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          dropCursor: false,
          allowMultipleSelections: false,
          indentOnInput: true,
        }}
      />
    </div>
  );
}
