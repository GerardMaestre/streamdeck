Param(
    [Parameter(Mandatory=$true)]
    [int]$Width,
    [Parameter(Mandatory=$true)]
    [int]$Height
)

$code = @"
using System;
using System.Runtime.InteropServices;

namespace ScreenResolution {
    [StructLayout(LayoutKind.Sequential)]
    public struct DEVMODE {
        private const int CCHDEVICENAME = 32;
        private const int CCHFORMNAME = 32;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCHDEVICENAME)]
        public string dmDeviceName;
        public short dmSpecVersion;
        public short dmDriverVersion;
        public short dmSize;
        public short dmDriverExtra;
        public int dmFields;
        public int dmPositionX;
        public int dmPositionY;
        public int dmDisplayOrientation;
        public int dmDisplayFixedOutput;
        public short dmColor;
        public short dmDuplex;
        public short dmYResolution;
        public short dmTTOption;
        public short dmCollate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCHFORMNAME)]
        public string dmFormName;
        public short dmLogPixels;
        public int dmBitsPerPel;
        public int dmPelsWidth;
        public int dmPelsHeight;
        public int dmDisplayFlags;
        public int dmDisplayFrequency;
        public int dmICMMethod;
        public int dmICMIntent;
        public int dmMediaType;
        public int dmDitherType;
        public int dmReserved1;
        public int dmReserved2;
        public int dmPanningWidth;
        public int dmPanningHeight;
    }

    public enum DISP_CHANGE : int {
        Successful = 0,
        Restart = 1,
        Failed = -1,
        BadMode = -2,
        NotUpdated = -3,
        BadFlags = -4,
        BadParam = -5,
        BadDualView = -6
    }

    public class Resolution {
        [DllImport("user32.dll")]
        public static extern int EnumDisplaySettings(string deviceName, int modeNum, ref DEVMODE devMode);
        [DllImport("user32.dll")]
        public static extern int ChangeDisplaySettings(ref DEVMODE devMode, int flags);

        public const int ENUM_CURRENT_SETTINGS = -1;
        public const int CDS_UPDATEREGISTRY = 0x01;
        public const int CDS_TEST = 0x02;
        public const int DISP_CHANGE_SUCCESSFUL = 0;
        public const int DISP_CHANGE_RESTART = 1;
        public const int DM_PELSWIDTH = 0x00080000;
        public const int DM_PELSHEIGHT = 0x00100000;

        public static string SetResolution(int width, int height) {
            DEVMODE dm = new DEVMODE();
            dm.dmSize = (short)Marshal.SizeOf(dm);
            if (0 != EnumDisplaySettings(null, ENUM_CURRENT_SETTINGS, ref dm)) {
                dm.dmPelsWidth = width;
                dm.dmPelsHeight = height;
                dm.dmFields = DM_PELSWIDTH | DM_PELSHEIGHT;
                int iRet = ChangeDisplaySettings(ref dm, CDS_UPDATEREGISTRY);
                switch (iRet) {
                    case DISP_CHANGE_SUCCESSFUL: return "OK";
                    case DISP_CHANGE_RESTART: return "RESTART";
                    default: return "FAILED: " + iRet.ToString();
                }
            }
            return "FAILED_ENUM";
        }
    }
}
"@

Add-Type -TypeDefinition $code

$result = [ScreenResolution.Resolution]::SetResolution($Width, $Height)
Write-Output $result
