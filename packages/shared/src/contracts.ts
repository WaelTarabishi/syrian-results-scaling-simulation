export type ResultStatus = "pass" | "fail";

export interface StudentResult {
  studentId: string;
  studentName: string;
  fatherName: string;
  academicYear: string;
  score: number;
  grade: string;
  status: ResultStatus;
}

export interface ResultSuccessResponse {
  success: true;
  data: StudentResult;
}

export type ResultErrorCode = "INVALID_REQUEST" | "RESULT_NOT_FOUND" | "INTERNAL_ERROR";

export interface ResultErrorResponse {
  success: false;
  error: {
    code: ResultErrorCode;
    message: string;
  };
}

export type ResultResponse = ResultSuccessResponse | ResultErrorResponse;
