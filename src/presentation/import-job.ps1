$ErrorActionPreference = 'Stop'
# The launcher applies Job Object limits while the worker is suspended.
[Console]::Error.WriteLine('DC_IMPORT_STAGE:bootstrap')
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class ImportJob {
 [StructLayout(LayoutKind.Sequential)] struct Basic { public long ProcessTime,JobTime; public uint Flags; public UIntPtr MinimumWorkingSet,MaximumWorkingSet; public uint ActiveProcesses; public UIntPtr Affinity; public uint Priority,Scheduling; }
 [StructLayout(LayoutKind.Sequential)] struct IO { public ulong ReadOps,WriteOps,OtherOps,ReadBytes,WriteBytes,OtherBytes; }
 [StructLayout(LayoutKind.Sequential)] struct Limits { public Basic Basic; public IO IO; public UIntPtr ProcessMemory,JobMemory,PeakProcessMemory,PeakJobMemory; }
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct Startup { public uint Size; public string Reserved,Desktop,Title; public uint X,Y,Width,Height,XChars,YChars,Fill,Flags; public ushort Show,ReservedSize; public IntPtr ReservedBytes,Input,Output,Error; }
 [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr Process,Thread; public uint Pid,Tid; }
 [StructLayout(LayoutKind.Sequential)] struct Accounting { public long User,Kernel,PeriodUser,PeriodKernel; public uint PageFaults,TotalProcesses,ActiveProcesses,TerminatedProcesses; }
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int info,ref Limits limits,uint size);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int info,out Limits limits,uint size,IntPtr returned);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int info,out Accounting accounting,uint size,IntPtr returned);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string application,StringBuilder command,IntPtr processAttributes,IntPtr threadAttributes,bool inherit,uint flags,IntPtr environment,string directory,ref Startup startup,out ProcessInfo process);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
 [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint timeout);
 [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
 [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int type);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle,uint mask,uint flags);
 [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
 [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process,uint code);
 [DllImport("kernel32.dll")] static extern bool TerminateJobObject(IntPtr job,uint code);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 static void Check(bool value) { if(!value) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); }
 static void Check(bool value,string operation) { if(!value) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(),operation); }
 static string Quote(string value) { if(value.IndexOf('"')>=0) throw new ArgumentException("Invalid launcher path"); return "\""+value+"\""; }
 static IntPtr Job(string name,ulong bytes) {
  IntPtr job=CreateJobObject(IntPtr.Zero,name); Check(job!=IntPtr.Zero);
  Limits limits=new Limits(); limits.Basic.Flags=0x2000|0x100|0x200|0x8; limits.Basic.ActiveProcesses=32; limits.ProcessMemory=(UIntPtr)bytes; limits.JobMemory=(UIntPtr)bytes;
  try { Check(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(Limits)))); return job; } catch { CloseHandle(job); throw; }
 }
 public static int Run(string node,string worker,ulong bytes,ulong aggregate,string scope,string heap) {
  IntPtr parent=IntPtr.Zero,job=IntPtr.Zero; ProcessInfo process=new ProcessInfo(); bool attached=false;
  try {
   parent=Job(scope,aggregate); job=Job(null,bytes);
   Startup startup=new Startup(); startup.Size=(uint)Marshal.SizeOf(typeof(Startup)); startup.Flags=0x100; startup.Input=GetStdHandle(-10); startup.Output=GetStdHandle(-11); startup.Error=GetStdHandle(-12);
   foreach(IntPtr handle in new[]{startup.Input,startup.Output,startup.Error}) Check(SetHandleInformation(handle,1,1));
   Check(CreateProcess(node,new StringBuilder(Quote(node)+" --max-old-space-size="+heap+" "+Quote(worker)+" --stdio"),IntPtr.Zero,IntPtr.Zero,true,4|0x08000000,IntPtr.Zero,null,ref startup,out process));
   Console.Error.WriteLine("DC_IMPORT_STAGE:created");
   Check(AssignProcessToJobObject(parent,process.Process),"Assign aggregate child job"); Check(AssignProcessToJobObject(job,process.Process),"Assign child job");
   Console.Error.WriteLine("DC_IMPORT_STAGE:assigned");
   attached=true;
   if(ResumeThread(process.Thread)==UInt32.MaxValue) Check(false);
   Console.Error.WriteLine("DC_IMPORT_STAGE:resumed");
   Check(WaitForSingleObject(process.Process,UInt32.MaxValue)==0); uint code; Check(GetExitCodeProcess(process.Process,out code));
   Console.Error.WriteLine("DC_IMPORT_STAGE:exited");
   Limits measured; Check(QueryInformationJobObject(job,9,out measured,(uint)Marshal.SizeOf(typeof(Limits)),IntPtr.Zero));
   Console.Error.WriteLine("{\"peakJobMemoryBytes\":"+measured.PeakJobMemory.ToUInt64()+",\"memoryLimitBytes\":"+measured.JobMemory.ToUInt64()+",\"processMemoryLimitBytes\":"+measured.ProcessMemory.ToUInt64()+"}");
   Check(TerminateJobObject(job,code));
   DateTime deadline=DateTime.UtcNow.AddSeconds(5);
   for(;;) {
    Accounting accounting; Check(QueryInformationJobObject(job,1,out accounting,(uint)Marshal.SizeOf(typeof(Accounting)),IntPtr.Zero));
    if(accounting.ActiveProcesses==0) break;
    if(DateTime.UtcNow>=deadline) throw new InvalidOperationException("Import process tree did not terminate");
    System.Threading.Thread.Sleep(10);
   }
   Console.Error.WriteLine("DC_IMPORT_STAGE:terminated");
   return (int)code;
  } finally {
   if(!attached && process.Process!=IntPtr.Zero) TerminateProcess(process.Process,125);
   if(process.Thread!=IntPtr.Zero) CloseHandle(process.Thread); if(process.Process!=IntPtr.Zero) CloseHandle(process.Process);
   if(job!=IntPtr.Zero) CloseHandle(job); if(parent!=IntPtr.Zero) CloseHandle(parent);
  }
 }
}
'@
[Console]::Error.WriteLine('DC_IMPORT_STAGE:compiled')
exit [ImportJob]::Run($args[0], $args[1], [UInt64]$args[2], [UInt64]$args[3], $args[4], $args[5])
