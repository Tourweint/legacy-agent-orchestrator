package org.campus.classroom.controller;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.campus.classroom.common.Result;
import org.campus.classroom.dto.SystemConfigUpdateDTO;
import org.campus.classroom.security.LoginUser;
import org.campus.classroom.service.AdminAuditService;
import org.campus.classroom.service.SystemConfigService;
import org.campus.classroom.vo.SystemConfigVO;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/admin/configs")
@RequiredArgsConstructor
@PreAuthorize("hasRole('ADMIN')")
public class AdminSystemConfigController {
    private final SystemConfigService systemConfigService;
    private final AdminAuditService adminAuditService;

    @GetMapping
    public Result<List<SystemConfigVO>> list(@RequestParam(required = false) String category) {
        return Result.success("获取配置列表成功", systemConfigService.listConfigs(category));
    }

    @PutMapping("/{key:.+}")
    public Result<SystemConfigVO> update(@PathVariable String key,
                                         @RequestBody @Valid SystemConfigUpdateDTO request,
                                         @AuthenticationPrincipal LoginUser loginUser) {
        SystemConfigVO configVO = systemConfigService.updateConfig(key, request.getConfigValue());
        adminAuditService.log(
                loginUser.getId(),
                loginUser.getUsername(),
                "SYSTEM_CONFIG_UPDATE",
                "SYSTEM_CONFIG",
                configVO.getId(),
                configVO.getConfigKey(),
                "value=" + configVO.getConfigValue()
        );
        return Result.success("配置更新成功", configVO);
    }
}
