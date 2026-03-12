/**
 * Browser Environment Type Declarations
 * 
 * 浏览器环境类型声明文件
 * 用于在 Node.js 项目中编译浏览器环境的代码
 */

// DOM Types
declare global {
  // HTMLElement
  interface HTMLElement {
    innerHTML: string;
    textContent: string | null;
    classList: DOMTokenList;
    style: CSSStyleDeclaration;
    tabIndex: number;
    querySelector(selectors: string): Element | null;
    querySelectorAll(selectors: string): NodeListOf<Element>;
    addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void;
    appendChild<T extends Node>(newChild: T): T;
    remove(): void;
    focus(): void;
    scrollTop: number;
    scrollHeight: number;
  }

  // Document
  interface Document {
    createElement(tagName: string): HTMLElement;
    createTextNode(data: string): Text;
    querySelector(selectors: string): Element | null;
    querySelectorAll(selectors: string): NodeListOf<Element>;
    head: HTMLElement;
    body: HTMLElement;
  }

  // Window
  interface Window {
    speechSynthesis: SpeechSynthesis;
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
    document: Document;
    setInterval(handler: TimerHandler, timeout?: number, ...arguments: any[]): number;
    clearInterval(id?: number): void;
    requestAnimationFrame(callback: FrameRequestCallback): number;
    cancelAnimationFrame(handle: number): void;
  }

  // Speech Synthesis
  interface SpeechSynthesis {
    speak(utterance: SpeechSynthesisUtterance): void;
    cancel(): void;
    pause(): void;
    resume(): void;
    getVoices(): SpeechSynthesisVoice[];
  }

  interface SpeechSynthesisUtteranceConstructor {
    new(text: string): SpeechSynthesisUtterance;
  }

  interface SpeechSynthesisUtterance extends EventTarget {
    text: string;
    voice: SpeechSynthesisVoice | null;
    rate: number;
    pitch: number;
    volume: number;
    lang: string;
    onstart: ((this: SpeechSynthesisUtterance, ev: Event) => any) | null;
    onend: ((this: SpeechSynthesisUtterance, ev: Event) => any) | null;
    onerror: ((this: SpeechSynthesisUtterance, ev: SpeechSynthesisErrorEvent) => any) | null;
  }

  interface SpeechSynthesisVoice {
    voiceURI: string;
    name: string;
    lang: string;
    localService: boolean;
    default: boolean;
  }

  interface SpeechSynthesisErrorEvent extends Event {
    error: string;
  }

  // Speech Recognition
  interface SpeechRecognition extends EventTarget {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    maxAlternatives: number;
    onstart: ((this: SpeechRecognition, ev: Event) => any) | null;
    onend: ((this: SpeechRecognition, ev: Event) => any) | null;
    onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any) | null;
    onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => any) | null;
    start(): void;
    stop(): void;
    abort(): void;
  }

  interface SpeechRecognitionEvent extends Event {
    readonly resultIndex: number;
    readonly results: SpeechRecognitionResultList;
  }

  interface SpeechRecognitionResultList {
    readonly length: number;
    item(index: number): SpeechRecognitionResult;
    [index: number]: SpeechRecognitionResult;
  }

  interface SpeechRecognitionResult {
    readonly length: number;
    item(index: number): SpeechRecognitionAlternative;
    [index: number]: SpeechRecognitionAlternative;
    readonly isFinal: boolean;
  }

  interface SpeechRecognitionAlternative {
    readonly transcript: string;
    readonly confidence: number;
  }

  interface SpeechRecognitionErrorEvent extends Event {
    error: string;
    message: string;
  }

  // Keyboard Event
  interface KeyboardEvent extends Event {
    readonly key: string;
    readonly code: string;
    readonly ctrlKey: boolean;
    readonly shiftKey: boolean;
    readonly altKey: boolean;
    readonly metaKey: boolean;
  }

  // HTML Audio Element
  interface HTMLAudioElement extends HTMLElement {
    src: string;
    currentTime: number;
    paused: boolean;
    onplay: ((this: HTMLAudioElement, ev: Event) => any) | null;
    onended: ((this: HTMLAudioElement, ev: Event) => any) | null;
    onerror: ((this: HTMLAudioElement, ev: ErrorEvent) => any) | null;
    play(): Promise<void>;
    pause(): void;
  }

  // Audio Constructor
  interface AudioConstructor {
    new(url?: string): HTMLAudioElement;
  }

  // Audio
  interface Audio extends HTMLAudioElement {}

  // CSS
  interface CSSStyleDeclaration {
    textContent: string;
  }

  interface DOMTokenList {
    add(...tokens: string[]): void;
    remove(...tokens: string[]): void;
    contains(token: string): boolean;
    toggle(token: string, force?: boolean): boolean;
  }

  // Node
  interface Node {
    appendChild<T extends Node>(newChild: T): T;
    removeChild<T extends Node>(oldChild: T): T;
  }

  // Element
  interface Element extends Node {
    classList: DOMTokenList;
    textContent: string | null;
  }

  // Text
  interface Text extends Node {
    data: string;
  }

  // NodeList
  interface NodeListOf<TNode extends Node> extends NodeList {
    length: number;
    item(index: number): TNode;
    [index: number]: TNode;
  }

  interface NodeList {
    length: number;
    item(index: number): Node | null;
    [index: number]: Node;
  }

  // Event
  interface Event {
    readonly type: string;
    readonly target: EventTarget | null;
  }

  interface EventTarget {
    addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean): void;
    removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean): void;
    dispatchEvent(event: Event): boolean;
  }

  interface EventListener {
    (evt: Event): void;
  }

  interface EventListenerObject {
    handleEvent(object: Event): void;
  }

  type EventListenerOrEventListenerObject = EventListener | EventListenerObject;

  interface AddEventListenerOptions extends EventListenerOptions {
    once?: boolean;
    passive?: boolean;
    capture?: boolean;
  }

  interface EventListenerOptions {
    capture?: boolean;
  }

  interface ErrorEvent extends Event {
    readonly message: string;
    readonly filename: string;
    readonly lineno: number;
    readonly colno: number;
    readonly error: any;
  }

  interface FrameRequestCallback {
    (time: number): void;
  }

  type TimerHandler = string | Function;

  // Global variables
  const document: Document;
  const window: Window;
  const SpeechSynthesisUtterance: SpeechSynthesisUtteranceConstructor;
  const Audio: AudioConstructor;
}

// Make this a module
export {};
