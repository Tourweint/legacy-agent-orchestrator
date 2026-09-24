package org.campus.classroom.service.impl;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.campus.classroom.dto.ChangePasswordDTO;
import org.campus.classroom.dto.EmailCodeSendDTO;
import org.campus.classroom.dto.EmailLoginDTO;
import org.campus.classroom.dto.RegisterDTO;
import org.campus.classroom.dto.ResetPasswordByCodeDTO;
import org.campus.classroom.dto.UpdateNicknameDTO;
import org.campus.classroom.entity.User;
import org.campus.classroom.enums.EmailCodeScene;
import org.campus.classroom.enums.ResultCode;
import org.campus.classroom.exception.BusinessException;
import org.campus.classroom.mapper.UserMapper;
import org.campus.classroom.security.DeviceContext;
import org.campus.classroom.security.LoginUser;
import org.campus.classroom.service.AuthService;
import org.campus.classroom.service.EmailCodeService;
import org.campus.classroom.service.SystemConfigService;
import org.campus.classroom.service.TokenService;
import org.campus.classroom.utils.JwtUtil;
import org.campus.classroom.vo.DeviceSessionVO;
import org.campus.classroom.vo.LoginVO;
import org.campus.classroom.vo.UserInfoVO;
import org.springframework.data.util.Pair;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Objects;

@Service
@RequiredArgsConstructor
@Slf4j
public class AuthServiceImpl implements AuthService {
    private final UserMapper userMapper;
    private final JwtUtil jwtUtil;
    private final PasswordEncoder passwordEncoder;
    private final SystemConfigService systemConfigService;
    private final TokenService tokenService;
    private final EmailCodeService emailCodeService;

    @Override
    public void sendEmailCode(EmailCodeSendDTO request) {
        EmailCodeScene scene = EmailCodeScene.fromCode(request.getScene());
        String email = request.getEmail().trim();
        validateEmailCodeScene(email, scene);
        emailCodeService.sendCode(email, scene);
    }

    @Override
    public void register(RegisterDTO request) {
        log.info("[开始注册] username={}, email={}", request.getUsername(), request.getEmail());
        assertUsernameAvailable(request.getUsername());
        assertEmailAvailable(request.getEmail());
        emailCodeService.verifyCode(request.getEmail(), EmailCodeScene.REGISTER, request.getVerificationCode());

        String normalizedUsername = request.getUsername().trim();
        String normalizedEmail = request.getEmail().trim().toLowerCase();
        String normalizedNickname = Objects.requireNonNullElse(request.getNickname(), "").trim();
        User user = new User();
        user.setUsername(normalizedUsername);
        user.setPassword(passwordEncoder.encode(request.getPassword()));
        user.setNickname(normalizedNickname.isEmpty() ? normalizedUsername : normalizedNickname);
        user.setEmail(normalizedEmail);
        user.setRole("STUDENT");

        int rows = userMapper.insert(user);
        if (rows <= 0) {
            log.error("[注册失败] username={}, 原因=写入数据库失败", request.getUsername());
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "注册失败");
        }
        log.info("[注册成功] userId={}, username={}", user.getId(), user.getUsername());
    }

    @Override
    public void validateLoginAccount(String username) {
        User user = userMapper.selectByUsername(username);
        if (user == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "用户不存在");
        }
        ensureUserActive(user);
    }

    @Override
    public LoginVO login(LoginUser loginUser, DeviceContext deviceContext) {
        log.info("[开始登录] userId={}, username={}", loginUser.getId(), loginUser.getUsername());
        String accessToken = jwtUtil.generateToken(loginUser, deviceContext);
        String refreshToken = tokenService.generateRefreshToken(loginUser.getId(), deviceContext);
        LoginVO loginVO = buildLoginVO(loginUser, accessToken, refreshToken);
        log.info("[登录成功] userId={}, username={}, role={}", loginUser.getId(), loginUser.getUsername(), loginUser.getRole());
        return loginVO;
    }

    @Override
    public LoginVO loginByEmailCode(EmailLoginDTO request, DeviceContext deviceContext) {
        User user = requireUserByEmail(request.getEmail());
        ensureUserActive(user);
        emailCodeService.verifyCode(request.getEmail(), EmailCodeScene.LOGIN, request.getVerificationCode());
        return login(new LoginUser(user), deviceContext);
    }

    @Override
    public LoginVO refresh(String refreshToken, DeviceContext deviceContext) {
        log.info("[刷新Token] request received");
        Pair<Long, String> rotateResult = tokenService.rotateRefreshToken(refreshToken, deviceContext);
        LoginUser loginUser = new LoginUser(requireActiveUser(rotateResult.getFirst()));
        String accessToken = jwtUtil.generateToken(loginUser, deviceContext);
        return buildLoginVO(loginUser, accessToken, rotateResult.getSecond());
    }

    @Override
    public void logout(String refreshToken) {
        Long userId = tokenService.validateRefreshToken(refreshToken);
        int updated = userMapper.incrementTokenVersion(userId);
        if (updated != 1) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "退出登录后未能刷新登录状态");
        }
        tokenService.revokeAllRefreshTokens(userId);
    }

    @Override
    public UserInfoVO getUserInfo(LoginUser loginUser) {
        log.info("[获取用户信息] userId={}, username={}", loginUser.getId(), loginUser.getUsername());
        return buildUserInfoVO(loginUser);
    }

    @Override
    public void changePassword(Long userId, ChangePasswordDTO request) {
        User user = requireActiveUser(userId);
        if (!passwordEncoder.matches(request.getOldPassword(), user.getPassword())) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "旧密码错误");
        }
        if (passwordEncoder.matches(request.getNewPassword(), user.getPassword())) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "新密码不能与旧密码相同");
        }
        updatePasswordAndRevokeTokens(user, request.getNewPassword());
        log.info("[修改密码成功] userId={}, username={}", user.getId(), user.getUsername());
    }

    @Override
    public void resetPasswordByEmailCode(ResetPasswordByCodeDTO request) {
        User user = requireUserByEmail(request.getEmail());
        ensureUserActive(user);
        emailCodeService.verifyCode(request.getEmail(), EmailCodeScene.RESET_PASSWORD, request.getVerificationCode());
        if (passwordEncoder.matches(request.getNewPassword(), user.getPassword())) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "新密码不能与旧密码相同");
        }
        updatePasswordAndRevokeTokens(user, request.getNewPassword());
        log.info("[邮箱重置密码成功] userId={}, username={}", user.getId(), user.getUsername());
    }

    @Override
    public UserInfoVO updateNickname(Long userId, UpdateNicknameDTO request) {
        User user = requireActiveUser(userId);
        String nickname = request.getNickname().trim();
        int rows = userMapper.updateNickname(userId, nickname);
        if (rows != 1) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "修改昵称失败");
        }
        user.setNickname(nickname);
        log.info("[修改昵称成功] userId={}, username={}, nickname={}", user.getId(), user.getUsername(), nickname);
        return buildUserInfoVO(new LoginUser(user));
    }

    @Override
    public List<DeviceSessionVO> listDeviceSessions(Long userId) {
        requireActiveUser(userId);
        return tokenService.listDeviceSessions(userId);
    }

    @Override
    public void revokeDeviceSession(Long userId, String deviceId) {
        requireActiveUser(userId);
        tokenService.revokeDeviceSession(userId, deviceId);
    }

    private void validateEmailCodeScene(String email, EmailCodeScene scene) {
        User user = userMapper.selectByEmail(email.trim().toLowerCase());
        switch (scene) {
            case REGISTER -> {
                if (user != null) {
                    throw new BusinessException(ResultCode.BAD_REQUEST, "邮箱已被注册");
                }
            }
            case LOGIN, RESET_PASSWORD -> {
                if (user == null) {
                    throw new BusinessException(ResultCode.NOT_FOUND, "邮箱未注册");
                }
                ensureUserActive(user);
            }
        }
    }

    private void assertUsernameAvailable(String username) {
        User existUser = userMapper.selectByUsername(username.trim());
        if (existUser != null) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "用户名已存在");
        }
    }

    private void assertEmailAvailable(String email) {
        User existUser = userMapper.selectByEmail(email.trim().toLowerCase());
        if (existUser != null) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "邮箱已被注册");
        }
    }

    private User requireUserByEmail(String email) {
        User user = userMapper.selectByEmail(email.trim().toLowerCase());
        if (user == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "用户不存在");
        }
        return user;
    }

    private User requireActiveUser(Long userId) {
        User user = userMapper.selectById(userId);
        if (user == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "用户不存在");
        }
        ensureUserActive(user);
        return user;
    }

    private void ensureUserActive(User user) {
        if (user.getStatus() == null || user.getStatus() != 1) {
            throw new BusinessException(ResultCode.FORBIDDEN, "用户已被封禁");
        }
    }

    private void updatePasswordAndRevokeTokens(User user, String newPassword) {
        int rows = userMapper.updatePassword(user.getId(), passwordEncoder.encode(newPassword));
        if (rows != 1) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "修改密码失败");
        }
        int updated = userMapper.incrementTokenVersion(user.getId());
        if (updated != 1) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "修改密码后未能刷新登录状态");
        }
        tokenService.revokeAllRefreshTokens(user.getId());
    }

    private LoginVO buildLoginVO(LoginUser loginUser, String accessToken, String refreshToken) {
        LoginVO loginVO = new LoginVO();
        loginVO.setAccessToken(accessToken);
        loginVO.setRefreshToken(refreshToken);
        loginVO.setUserInfo(buildUserInfoVO(loginUser));
        return loginVO;
    }

    private UserInfoVO buildUserInfoVO(LoginUser loginUser) {
        UserInfoVO userInfoVO = new UserInfoVO();
        userInfoVO.setId(loginUser.getId());
        userInfoVO.setUsername(loginUser.getUsername());
        userInfoVO.setNickname(loginUser.getNickname());
        userInfoVO.setEmail(loginUser.getEmail());
        userInfoVO.setRole(loginUser.getRole());
        fillUserCreditInfo(userInfoVO, loginUser.getRole(), loginUser.getCreditScore());
        return userInfoVO;
    }

    private void fillUserCreditInfo(UserInfoVO userInfoVO, String role, Integer creditScore) {
        Integer quotaCreditScore = resolveQuotaCreditScore(role, creditScore);
        userInfoVO.setCreditScore(quotaCreditScore);
        userInfoVO.setCreditLevel(systemConfigService.getCreditLevelCode(quotaCreditScore));
        userInfoVO.setSeatReservationAdvanceHours(systemConfigService.getSeatReservationAdvanceHours(quotaCreditScore));
        userInfoVO.setMaxSingleReservationMinutes(systemConfigService.getMaxSingleReservationMinutes(quotaCreditScore));
        userInfoVO.setDailyReservationLimitMinutes(systemConfigService.getDailyReservationLimitMinutes(quotaCreditScore));
    }

    private Integer resolveQuotaCreditScore(String role, Integer creditScore) {
        if ("TEACHER".equals(role)) {
            return systemConfigService.getCreditMaxScore();
        }
        return creditScore == null ? systemConfigService.getCreditMaxScore() : creditScore;
    }
}
