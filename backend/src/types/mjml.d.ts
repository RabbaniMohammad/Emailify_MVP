declare module 'mjml' {
  export interface MjmlParsingOpts {
    validationLevel?: 'strict' | 'soft' | 'skip';
    beautify?: boolean;
    minify?: boolean;
    keepComments?: boolean;
    filePath?: string;
  }

  export interface MjmlError {
    line?: number;
    message?: string;
    tagName?: string;
    formattedMessage?: string;
  }

  export interface MjmlOutput {
    html: string;
    errors?: MjmlError[];  // ✅ CHANGED: Made optional with ?
  }

  export default function mjml2html(
    input: string,
    options?: MjmlParsingOpts
  ): MjmlOutput;

  export function mjml2html(
    input: string,
    options?: MjmlParsingOpts
  ): MjmlOutput;
}
