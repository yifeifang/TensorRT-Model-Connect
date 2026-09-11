#include <cstdio>
#include <cwchar>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>
#include <windows.h>

namespace {
class Handle {
  public:
    explicit Handle(HANDLE value = nullptr) : value_(value) {}
    ~Handle() {
        if (value_ && value_ != INVALID_HANDLE_VALUE)
            CloseHandle(value_);
    }
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
    HANDLE get() const { return value_; }

  private:
    HANDLE value_;
};

class WinError : public std::runtime_error {
  public:
    WinError(const char* operation, DWORD code = GetLastError())
        : std::runtime_error(std::string(operation) + " failed (Win32 " + std::to_string(code) +
                             ")."),
          code_(code) {}
    DWORD code() const { return code_ ? code_ : ERROR_GEN_FAILURE; }

  private:
    DWORD code_;
};

class Attributes {
  public:
    Attributes() {
        SIZE_T bytes = 0;
        InitializeProcThreadAttributeList(nullptr, 2, 0, &bytes);
        if (!bytes)
            throw WinError("Measure process attributes");
        storage_.resize(bytes);
        list_ = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(storage_.data());
        if (!InitializeProcThreadAttributeList(list_, 2, 0, &bytes))
            throw WinError("Initialize process attributes");
    }
    ~Attributes() { DeleteProcThreadAttributeList(list_); }
    Attributes(const Attributes&) = delete;
    Attributes& operator=(const Attributes&) = delete;
    LPPROC_THREAD_ATTRIBUTE_LIST get() const { return list_; }
    void add(DWORD_PTR key, void* value, SIZE_T bytes) {
        if (!UpdateProcThreadAttribute(list_, 0, key, value, bytes, nullptr, nullptr))
            throw WinError("Set process attributes");
    }

  private:
    std::vector<unsigned char> storage_;
    LPPROC_THREAD_ATTRIBUTE_LIST list_ = nullptr;
};

DWORD parse_pid(const wchar_t* value) {
    if (!value || !*value)
        throw std::invalid_argument("Parent PID must be a positive decimal integer.");
    unsigned long long number = 0;
    for (const wchar_t* cursor = value; *cursor; ++cursor) {
        if (*cursor < L'0' || *cursor > L'9')
            throw std::invalid_argument("Parent PID must be a positive decimal integer.");
        const unsigned digit = static_cast<unsigned>(*cursor - L'0');
        if (number > (std::numeric_limits<DWORD>::max() - digit) / 10ULL)
            throw std::invalid_argument("Parent PID exceeds the Windows PID range.");
        number = number * 10ULL + digit;
    }
    if (!number || number == GetCurrentProcessId())
        throw std::invalid_argument("Parent PID must identify another process.");
    return static_cast<DWORD>(number);
}

// Encode one CRT argv argument, including empty strings, embedded quotes and
// trailing backslashes. Never pass the resulting command line to a shell.
std::wstring quote_argument(const std::wstring& argument) {
    std::wstring quoted = L"\"";
    std::size_t backslashes = 0;
    for (wchar_t character : argument) {
        if (character == L'\\') {
            ++backslashes;
            continue;
        }
        if (character == L'\"') {
            quoted.append(backslashes * 2 + 1, L'\\');
            quoted.push_back(L'\"');
        } else {
            quoted.append(backslashes, L'\\');
            quoted.push_back(character);
        }
        backslashes = 0;
    }
    quoted.append(backslashes * 2, L'\\');
    quoted.push_back(L'\"');
    return quoted;
}

HANDLE duplicate_standard(DWORD kind) {
    const HANDLE original = GetStdHandle(kind);
    if (!original || original == INVALID_HANDLE_VALUE)
        throw WinError("Get standard stream", ERROR_INVALID_HANDLE);
    HANDLE copy = nullptr;
    if (!DuplicateHandle(GetCurrentProcess(), original, GetCurrentProcess(), &copy, 0, TRUE,
                         DUPLICATE_SAME_ACCESS))
        throw WinError("Duplicate standard stream");
    return copy;
}

int run(int argc, wchar_t** argv) {
    if (argc < 5 || std::wcscmp(argv[1], L"--parent-pid") || std::wcscmp(argv[3], L"--") ||
        !*argv[4])
        throw std::invalid_argument(
            "Usage: modelconnect_process_host --parent-pid PID -- TARGET_EXE TARGET_ARGS...");
    const DWORD parent_pid = parse_pid(argv[2]);
    const Handle parent(OpenProcess(SYNCHRONIZE, FALSE, parent_pid));
    if (!parent.get())
        throw WinError("Open parent process");
    const DWORD parent_status = WaitForSingleObject(parent.get(), 0);
    if (parent_status == WAIT_OBJECT_0)
        return ERROR_CANCELLED;
    if (parent_status == WAIT_FAILED)
        throw WinError("Check parent process");

    // Neither the watched parent handle nor the job handle is inheritable.
    // Closing this guardian's sole job handle kills every process in the job.
    const Handle job(CreateJobObjectW(nullptr, nullptr));
    if (!job.get())
        throw WinError("Create job object");
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if (!SetInformationJobObject(job.get(), JobObjectExtendedLimitInformation, &limits,
                                 sizeof(limits)))
        throw WinError("Set job limits");

    const Handle input(duplicate_standard(STD_INPUT_HANDLE));
    const Handle output(duplicate_standard(STD_OUTPUT_HANDLE));
    const Handle error(duplicate_standard(STD_ERROR_HANDLE));
    HANDLE streams[] = {input.get(), output.get(), error.get()};
    HANDLE job_list[] = {job.get()};
    Attributes attributes;
    attributes.add(PROC_THREAD_ATTRIBUTE_HANDLE_LIST, streams, sizeof(streams));
    // Windows 10+ assigns the job atomically during process creation. This
    // avoids an orphan if the guardian dies between CreateProcess and a later
    // AssignProcessToJobObject call. The thread still starts suspended.
    attributes.add(PROC_THREAD_ATTRIBUTE_JOB_LIST, job_list, sizeof(job_list));

    std::wstring command_line;
    for (int index = 4; index < argc; ++index) {
        if (index > 4)
            command_line.push_back(L' ');
        command_line += quote_argument(argv[index]);
    }
    if (command_line.size() >= 32767)
        throw std::invalid_argument("Child command line exceeds the Windows length limit.");
    STARTUPINFOEXW startup{};
    startup.StartupInfo.cb = sizeof(startup);
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = input.get();
    startup.StartupInfo.hStdOutput = output.get();
    startup.StartupInfo.hStdError = error.get();
    startup.lpAttributeList = attributes.get();
    PROCESS_INFORMATION process{};
    if (!CreateProcessW(argv[4], command_line.data(), nullptr, nullptr, TRUE,
                        CREATE_SUSPENDED | CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT, nullptr,
                        nullptr, &startup.StartupInfo, &process))
        throw WinError("Create child process");
    const Handle child(process.hProcess);
    const Handle thread(process.hThread);
    BOOL assigned = FALSE;
    if (!IsProcessInJob(child.get(), job.get(), &assigned) || !assigned) {
        const DWORD code = GetLastError();
        TerminateProcess(child.get(), ERROR_PROCESS_ABORTED);
        throw WinError("Verify child job membership", code ? code : ERROR_ACCESS_DENIED);
    }
    if (WaitForSingleObject(parent.get(), 0) == WAIT_OBJECT_0) {
        TerminateJobObject(job.get(), ERROR_CANCELLED);
        WaitForSingleObject(child.get(), 5000);
        return ERROR_CANCELLED;
    }
    if (ResumeThread(thread.get()) == static_cast<DWORD>(-1)) {
        const DWORD code = GetLastError();
        TerminateJobObject(job.get(), ERROR_PROCESS_ABORTED);
        throw WinError("Resume child process", code);
    }

    const HANDLE watched[] = {child.get(), parent.get()};
    const DWORD result = WaitForMultipleObjects(2, watched, FALSE, INFINITE);
    if (result == WAIT_OBJECT_0) {
        DWORD exit_code = ERROR_GEN_FAILURE;
        if (!GetExitCodeProcess(child.get(), &exit_code))
            throw WinError("Read child exit code");
        return static_cast<int>(exit_code);
    }
    if (result == WAIT_OBJECT_0 + 1) {
        if (!TerminateJobObject(job.get(), ERROR_CANCELLED))
            throw WinError("Stop orphaned child job");
        WaitForSingleObject(child.get(), 5000);
        return ERROR_CANCELLED;
    }
    throw WinError("Wait for child or parent");
}
} // namespace

int wmain(int argc, wchar_t** argv) {
    SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX);
    try {
        return run(argc, argv);
    } catch (const WinError& error) {
        std::fprintf(stderr, "ModelConnect process host: %s\n", error.what());
        return static_cast<int>(error.code());
    } catch (const std::exception& error) {
        std::fprintf(stderr, "ModelConnect process host: %s\n", error.what());
        return ERROR_INVALID_PARAMETER;
    }
}
