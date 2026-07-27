export const apiFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const options = init || {};
  options.headers = {
    ...options.headers,
    'ngrok-skip-browser-warning': 'true'
  };
  return fetch(input, options);
};
