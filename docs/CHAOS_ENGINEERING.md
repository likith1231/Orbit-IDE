# Chaos Engineering in AI Cloud IDE

The chaos engineering suite tests how well your code handles adverse, real-world conditions. Software doesn't exist in a vacuum; it runs on servers with limited resources, competing processes, and flaky hardware.

## Chaos Scenarios

### 1. Memory Limit (16MB)
Tests your code's memory efficiency.
- **Why it matters**: Cloud environments (like AWS Lambda or Kubernetes) enforce strict memory limits. If your code slurps whole files into memory instead of streaming them, it will crash with an OOM (Out Of Memory) error.
- **Failure Category**: Usually results in `oom-killed`.

### 2. CPU Throttle (5%)
Restricts your application to a tiny fraction of a single CPU core.
- **Why it matters**: In heavily multitenant systems or during \"noisy neighbor\" events, your app might be starved of CPU time. This tests if your code can still complete its tasks within a reasonable timeout when it's forced to run slowly.
- **Failure Category**: Usually results in `cpu-starved`.

### 3. Early & Mid-flight Kills (1s, 3s)
Abruptly terminates the container after a set duration.
- **Why it matters**: Simulates sudden instance termination (e.g., AWS Spot Instances, Kubernetes evictions). Ensures that your application can safely checkpoint state or fail gracefully instead of corrupting data.
- **Failure Category**: Usually results in `timeout`.

### 4. No Network
Runs the application with a disabled networking stack (`NetworkMode: none`).
- **Why it matters**: Prevents your application from reaching external APIs or databases. Tests if you have proper offline fallbacks, graceful degradation, and error handling for `ENOTFOUND` or `ECONNREFUSED`.
- **Failure Category**: Can result in `runtime-error` if an unhandled network exception occurs.

### 5. Flaky Network (Drops at 500ms)
Connects the container to the network but disconnects it mid-execution.
- **Why it matters**: Real-world networks are rarely permanently down; they often drop connections mid-flight. This tests if your application handles dropped packets and `ECONNRESET` errors safely. 
*(Note: A full `tc` sidecar for precise packet loss was skipped as plain Dockerode makes orchestrating sidecars complex without `CAP_NET_ADMIN` privileges; dynamically dropping the bridge network achieves a similar mid-flight disruption.)*

### 6. Disk Write Limit (1MB tmpfs)
Mounts the container's temporary directory `/tmp` as a `1MB` `tmpfs` RAM disk.
- **Why it matters**: Prevents your code from relying on infinite disk space. If your code creates massive temporary files without cleaning them up, it will crash with a `No space left on device` error.
*(Note: True filesystem latency injection like `BlkioDeviceReadBps` requires hardcoding the host machine's block device, such as `/dev/sda`, which isn't portable across different cloud providers, so it is skipped.)*

## Resilience Score & Summary
When a chaos test runs, each scenario is evaluated against your code.
- **Resilience Score**: Calculated as `(Passed Scenarios / Total Scenarios) * 100`. A higher score means your code is more robust against environmental failures.
- **Failure Categories**: Extracted directly from Docker's `container.inspect()` state (checking `OOMKilled` and `ExitCode`), giving precise diagnostics on *how* the environment broke the code (e.g., `oom-killed`, `timeout`, `clean-exit`, `cpu-starved`).
- **Summary**: We generate a high-level summary (e.g., \"Your code is memory-fragile but CPU-resilient\") based on specific scenario failures.
