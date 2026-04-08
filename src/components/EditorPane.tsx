'use client';

import CodeMirror from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import { domId, domIdSuffix } from '@/lib/domId';

interface EditorPaneProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
}

const extensions = [
  markdown({ base: markdownLanguage, codeLanguages: languages }),
  EditorView.lineWrapping,
];

// Main component export: this is the entry point rendered by parent routes/components.
export default function EditorPane({ value, onChange, readOnly = false }: EditorPaneProps) {
  return (
    <div id="editor-pane-div-001" className="flex-1 overflow-hidden flex flex-col">
      <CodeMirror
        value={value}
        onChange={onChange}
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
        editable={!readOnly}
        readOnly={readOnly}
      />
    </div>
  );
}
