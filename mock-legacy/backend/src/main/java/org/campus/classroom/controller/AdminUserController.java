package org.campus.classroom.controller;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.campus.classroom.common.Result;
import org.campus.classroom.dto.AdminForceLogoutDTO;
import org.campus.classroom.dto.AdminUserStatusUpdateDTO;
import org.campus.classroom.security.LoginUser;
import org.campus.classroom.service.AdminAuditService;
import org.campus.classroom.service.AdminService;
import org.campus.classroom.vo.AdminUserVO;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;

@RestController
@RequestMapping("/admin/users")
@RequiredArgsConstructor
@PreAuthorize("hasRole('ADMIN')")
public class AdminUserController {
    private final AdminService adminService;
    private final AdminAuditService adminAuditService;

    @GetMapping
    public Result<List<AdminUserVO>> list(@RequestParam(required = false) String keyword,
                                          @RequestParam(required = false) String role,
                                          @RequestParam(required = false) Integer status) {
        return Result.success("获取用户列表成功", adminService.listUsers(keyword, role, status));
    }

    @GetMapping("/export")
    public ResponseEntity<byte[]> export(@RequestParam(required = false) String keyword,
                                         @RequestParam(required = false) String role,
                                         @RequestParam(required = false) Integer status) {
        List<AdminUserVO> users = adminService.listUsers(keyword, role, status);
        byte[] content = buildUserCsv(users).getBytes(StandardCharsets.UTF_8);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment()
                        .filename("admin-users.csv", StandardCharsets.UTF_8)
                        .build()
                        .toString())
                .contentType(MediaType.parseMediaType("text/csv;charset=UTF-8"))
                .body(content);
    }

    @PatchMapping("/{id}/status")
    public Result<AdminUserVO> updateStatus(@PathVariable Long id,
                                            @RequestBody @Valid AdminUserStatusUpdateDTO request,
                                            @AuthenticationPrincipal LoginUser loginUser) {
        AdminUserVO userVO = adminService.updateUserStatus(loginUser.getId(), id, request.getStatus(), request.getReason());
        adminAuditService.log(
                loginUser.getId(),
                loginUser.getUsername(),
                "USER_STATUS_UPDATE",
                "USER",
                userVO.getId(),
                userVO.getUsername(),
                "status=" + userVO.getStatus() + (request.getReason() == null || request.getReason().isBlank() ? "" : ", reason=" + request.getReason().trim())
        );
        return Result.success(
                "用户状态更新成功",
                userVO
        );
    }

    @PostMapping("/{id}/logout")
    public Result<Void> forceLogout(@PathVariable Long id,
                                    @RequestBody @Valid AdminForceLogoutDTO request,
                                    @AuthenticationPrincipal LoginUser loginUser) {
        AdminUserVO userVO = adminService.forceLogoutUser(loginUser.getId(), id, request.getReason());
        adminAuditService.log(
                loginUser.getId(),
                loginUser.getUsername(),
                "USER_FORCE_LOGOUT",
                "USER",
                userVO.getId(),
                userVO.getUsername(),
                request.getReason()
        );
        return Result.success("用户已强制下线");
    }

    private String buildUserCsv(List<AdminUserVO> users) {
        StringBuilder csv = new StringBuilder("\uFEFF");
        csv.append("用户ID,用户名,昵称,邮箱,角色,状态,创建时间\n");
        for (AdminUserVO user : users) {
            appendRow(csv,
                    user.getId(),
                    user.getUsername(),
                    user.getNickname(),
                    user.getEmail(),
                    roleText(user.getRole()),
                    statusText(user.getStatus()),
                    formatTime(user.getCreateTime())
            );
        }
        return csv.toString();
    }

    private void appendRow(StringBuilder csv, Object... values) {
        for (int i = 0; i < values.length; i++) {
            if (i > 0) {
                csv.append(',');
            }
            csv.append(escapeCsv(values[i]));
        }
        csv.append('\n');
    }

    private String escapeCsv(Object value) {
        String text = value == null ? "" : String.valueOf(value);
        if (text.contains("\"") || text.contains(",") || text.contains("\n") || text.contains("\r")) {
            return "\"" + text.replace("\"", "\"\"") + "\"";
        }
        return text;
    }

    private String roleText(String role) {
        if ("ADMIN".equals(role)) {
            return "管理员";
        }
        if ("TEACHER".equals(role)) {
            return "教师";
        }
        if ("STUDENT".equals(role)) {
            return "学生";
        }
        return role;
    }

    private String statusText(Integer status) {
        if (status == null) {
            return "";
        }
        return status == 1 ? "正常" : "已封禁";
    }

    private String formatTime(LocalDateTime time) {
        return time == null ? "" : time.format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
    }
}
