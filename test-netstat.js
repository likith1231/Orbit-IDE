const out = `
Active Internet connections (servers and established)
Proto Recv-Q Send-Q Local Address           Foreign Address         State
tcp        0      0 0.0.0.0:3000            0.0.0.0:*               LISTEN
tcp        0      0 :::8080                 :::*                    LISTEN
`;
const mappedPorts = { "3000/tcp": "32001", "5000/tcp": "32002", "8080/tcp": "32003" };
const activeMappedPorts = {};
for (const [key, value] of Object.entries(mappedPorts)) {
   const internalPort = key.split('/')[0];
   if ((out.includes(`:${internalPort} `) || out.includes(`:${internalPort}\t`) || new RegExp(`:${internalPort}\\s+.*LISTEN`).test(out))) {
     activeMappedPorts[key] = value;
   }
}
console.log(activeMappedPorts);
