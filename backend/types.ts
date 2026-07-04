export type User = {
  id: string;
  email: string;
  password: string;
  name: string | null;
  createdAt: string;
};

export type File = {
  id: string;
  name: string;
  path: string;
  isFolder: boolean;
  language: string;
  content: string;
  projectId: string;
  createdAt: string;
  updatedAt: string;
};

export type Project = {
  id: string;
  name: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  files?: File[];
};

export type ProjectWithFiles = Project & {
  files: File[];
};

export type AuthSignupBody = {
  email: string;
  password: string;
  name?: string;
};

export type AuthLoginBody = {
  email: string;
  password: string;
};

export type ProjectCreateBody = {
  name?: string;
};

export type FileSaveBody = {
  content: string;
};

export type FileCreateBody = {
  name: string;
  language?: string;
  path?: string;
  isFolder?: boolean;
};

export type FileRenameBody = {
  name: string;
};

export type ScaffoldItem = {
  name: string;
  path?: string;
  isFolder?: boolean;
  language?: string;
  content?: string;
};

export type ScaffoldRequestBody = {
  items: ScaffoldItem[];
};

export type ChaosTestBody = {
  code: string;
  language: string;
  fileName: string;
};

export type AIChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type AIChatFileTreeItem = {
  name: string;
  path: string;
  isFolder: boolean;
};

export type AIChatActiveFile = {
  name: string;
  path: string;
  content: string;
};

export type AIChatRequestBody = {
  messages: AIChatMessage[];
  fileTree?: AIChatFileTreeItem[];
  activeFile?: AIChatActiveFile | null;
};

export type AIDebugRequestBody = {
  code: string;
  language: string;
  fileName: string;
  error: string;
};

export type AuthResponse = {
  token: string;
  user: Pick<User, 'id' | 'email' | 'name'>;
};

export type MeResponse = {
  user: Pick<User, 'id' | 'email' | 'name'>;
};

export type ProjectsListResponse = {
  projects: Project[];
};

export type ProjectResponse = {
  project: ProjectWithFiles;
};

export type FileResponse = {
  file: File;
};

export type DeleteResponse = {
  deleted: true;
};

export type ScaffoldResponse = {
  files: File[];
};

export type RunResponse = {
  output?: string;
  error?: string;
};

export type ChaosResult = {
  scenario: string;
  output: string;
  elapsed: number;
  survived: boolean;
  killed: boolean;
};

export type ChaosResponse = {
  results: ChaosResult[];
  resilienceScore: number;
  total: number;
  survived: number;
  error?: string;
};

export type AIChatAction = 'scaffold' | 'apply' | 'run' | 'reply';

export type AIChatResponse =
  | {
      reply: string;
      action?: 'reply';
    }
  | {
      reply: string;
      action: 'scaffold';
      items: ScaffoldItem[];
    }
  | {
      reply: string;
      action: 'apply';
      code: string;
      fileName: string;
    }
  | {
      reply: string;
      action: 'run';
      fileName: string;
    }
  | {
      error: string;
    };

export type AIDebugResponse = {
  fixed: string;
  explanation?: string;
} | {
  error: string;
};

export type ErrorResponse = {
  error: string;
};

export type ContainerInfo = {
  Id: string;
  Names?: string[];
  State: string;
};

export type ContainersListResponse = {
  containers: ContainerInfo[];
};

export interface ClientToServerEvents {
  'terminal-input': (data: string) => void;
}

export interface ServerToClientEvents {
  'terminal-output': (data: string) => void;
}
